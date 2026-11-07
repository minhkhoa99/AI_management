import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  SESSION_COOKIE_NAME,
  TRACE_ID_HEADER,
} from '@aiteam/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiteamApplication } from './app-factory';
import { SECURITY_HEADERS } from './shared/security/security-headers.middleware';
import { applyPendingMigrations } from './shared/database/migration-runner';
import { ALL_MIGRATIONS } from './shared/database/migrations';
import {
  IN_MEMORY_DATABASE_LOCATION,
  openSqliteDatabase,
} from './shared/database/sqlite-connection';
import { createAppLogger } from './shared/logging/app-logger';

const SESSION_TOKEN = 'test-session-token-0123456789abcdef0123456789';
const LISTEN_PORT = 7419;
const ALLOWED_HOST = `127.0.0.1:${LISTEN_PORT}`;
const ALLOWED_ORIGIN = `http://127.0.0.1:${LISTEN_PORT}`;
const VALID_SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('aiteam HTTP application (e2e)', () => {
  let application: NestFastifyApplication;
  let database: DatabaseSync;
  let webRootDirectory: string;

  beforeAll(async () => {
    webRootDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-web-'));
    writeFileSync(
      path.join(webRootDirectory, 'index.html'),
      '<!doctype html><title>AI Team</title>',
    );

    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(database, ALL_MIGRATIONS);
    application = await createAiteamApplication({
      runtimeConfig: {
        version: '9.9.9-test',
        startedAtEpochMs: Date.now() - 3_000,
        sessionToken: SESSION_TOKEN,

        secretKeyFilePath: path.join(tmpdir(), `aiteam-test-secret-${process.pid}.key`),
        listenPort: LISTEN_PORT,
        dataDirectory: tmpdir(),
      },
      database,
      logger: createAppLogger({ level: 'silent' }),
      webRootDirectory,
    });
  });

  afterAll(async () => {
    await application.close();
    database.close();
    rmSync(webRootDirectory, { recursive: true, force: true });
  });

  function sendRequest(
    url: string,
    headers: Record<string, string> = {},
    method: HttpMethod = 'GET',
  ) {
    return application.inject({ method, url, headers: { host: ALLOWED_HOST, ...headers } });
  }

  function readErrorCode(response: Awaited<ReturnType<typeof sendRequest>>): string {
    return apiErrorResponseSchema.parse(response.json()).error.code;
  }

  describe('health', () => {
    it('answers ok without a session', async () => {
      const response = await sendRequest('/api/health');

      expect(response.statusCode).toBe(200);
      const body = healthResponseSchema.parse(response.json());
      expect(body).toMatchObject({ status: 'ok', version: '9.9.9-test' });
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(3);
      expect(response.headers[TRACE_ID_HEADER]).toEqual(expect.any(String));
    });

    it('reuses a well-formed incoming trace id', async () => {
      const response = await sendRequest('/api/health', {
        [TRACE_ID_HEADER]: 'client-trace-12345',
      });

      expect(response.headers[TRACE_ID_HEADER]).toBe('client-trace-12345');
    });
  });

  describe('session exchange (/?session=<token>)', () => {
    it('sets an HttpOnly SameSite=Strict cookie and redirects to / with a valid token', async () => {
      const response = await sendRequest(`/?session=${SESSION_TOKEN}`);

      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe('/');
      expect(response.headers['set-cookie']).toBe(
        `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
      );
    });

    it('rejects an invalid token without setting a cookie or echoing the token', async () => {
      const response = await sendRequest('/?session=stale-token-from-old-launch');

      expect(response.statusCode).toBe(403);
      expect(readErrorCode(response)).toBe('SESSION_LINK_INVALID');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body).not.toContain('stale-token-from-old-launch');
    });

    it('lets the cookie obtained from the exchange call the API', async () => {
      const exchange = await sendRequest(`/?session=${SESSION_TOKEN}`);
      const cookiePair = String(exchange.headers['set-cookie']).split(';')[0] ?? '';

      const response = await sendRequest('/api/departments', { cookie: cookiePair });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('session cookie on API and SSE paths', () => {
    it.each(['/api/departments', '/api/stream/workspace'])(
      'rejects %s without the cookie',
      async (url) => {
        const response = await sendRequest(url);

        expect(response.statusCode).toBe(403);
        const body = apiErrorResponseSchema.parse(response.json());
        expect(body.error.code).toBe('SESSION_REQUIRED');
        expect(body.error.traceId).toBe(response.headers[TRACE_ID_HEADER]);
      },
    );

    it.each([
      ['wrong value', `${SESSION_COOKIE_NAME}=wrong-token`],
      ['other cookie only', 'unrelated=1'],
      ['duplicated cookie', `${VALID_SESSION_COOKIE}; ${SESSION_COOKIE_NAME}=other`],
    ])('rejects a %s', async (_label, cookieHeader) => {
      const response = await sendRequest('/api/departments', { cookie: cookieHeader });

      expect(response.statusCode).toBe(403);
      expect(readErrorCode(response)).toBe('SESSION_REQUIRED');
    });

    it('ignores the old x-aiteam-token header', async () => {
      const response = await sendRequest('/api/departments', { 'x-aiteam-token': SESSION_TOKEN });

      expect(response.statusCode).toBe(403);
    });

    it.each(['/%61pi/departments', '/api/departments?x=1', '/api/departments/'])(
      'does not let %s bypass the cookie check',
      async (url) => {
        const response = await sendRequest(url);

        expect(response.statusCode).toBe(403);
      },
    );

    it('never echoes the query string in 404 errors', async () => {
      const response = await sendRequest('/missing-page?q=leaked-secret-value', {
        cookie: VALID_SESSION_COOKIE,
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('leaked-secret-value');
    });
  });

  describe('Host header', () => {
    it('accepts 127.0.0.1:<port>', async () => {
      const response = await sendRequest('/api/health', { host: `127.0.0.1:${LISTEN_PORT}` });

      expect(response.statusCode).toBe(200);
    });

    it.each([
      // Previews run on localhost: the UI must not share their site (cookies ignore ports).
      ['localhost (reserved for task previews)', `localhost:${LISTEN_PORT}`],
      ['a foreign domain (DNS rebinding)', `evil.example:${LISTEN_PORT}`],
      ['loopback on another port', '127.0.0.1:8080'],
      ['loopback without port', '127.0.0.1'],
      ['IPv6 loopback', `[::1]:${LISTEN_PORT}`],
    ])('rejects %s', async (_label, host) => {
      const response = await sendRequest('/api/health', { host });

      expect(response.statusCode).toBe(403);
      expect(readErrorCode(response)).toBe('HOST_NOT_ALLOWED');
    });

    it('also guards static files', async () => {
      const response = await sendRequest('/', { host: 'evil.example' });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Origin header on state-changing requests', () => {
    it.each<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'rejects %s from a foreign origin even with a valid cookie',
      async (method) => {
        const response = await sendRequest(
          '/api/departments',
          { cookie: VALID_SESSION_COOKIE, origin: 'https://evil.example' },
          method,
        );

        expect(response.statusCode).toBe(403);
        expect(readErrorCode(response)).toBe('ORIGIN_NOT_ALLOWED');
      },
    );

    it.each([
      ['missing', undefined],
      ['null', 'null'],
      ['another loopback port', 'http://127.0.0.1:8080'],
      ['localhost (task previews)', `http://localhost:${LISTEN_PORT}`],
    ])('rejects a write with %s Origin', async (_label, origin) => {
      const headers: Record<string, string> = { cookie: VALID_SESSION_COOKIE };
      if (origin !== undefined) {
        headers.origin = origin;
      }
      const response = await sendRequest('/api/departments', headers, 'POST');

      expect(response.statusCode).toBe(403);
      expect(readErrorCode(response)).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('lets a same-origin write with the cookie reach routing', async () => {
      const response = await sendRequest(
        '/api/not-a-route',
        { cookie: VALID_SESSION_COOKIE, origin: ALLOWED_ORIGIN },
        'POST',
      );

      // Passed Host, Origin and session checks: reaches routing.
      expect(response.statusCode).toBe(404);
      expect(readErrorCode(response)).toBe('ROUTE_NOT_FOUND');
    });

    it('does not require Origin on reads', async () => {
      const response = await sendRequest('/api/health');

      expect(response.statusCode).toBe(200);
    });
  });

  describe('static web build', () => {
    it('serves / without a session (no data in static files)', async () => {
      const response = await sendRequest('/');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<title>AI Team</title>');
    });
  });

  describe('security headers', () => {
    it.each([
      ['a UI page', '/', {}],
      ['an API response', '/api/departments', { cookie: VALID_SESSION_COOKIE }],
      ['an error', '/api/departments', {}],
    ])('are sent with %s (no framing of the UI, no sniffing)', async (_label, url, headers) => {
      const response = await sendRequest(url, headers);

      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(response.headers[name]).toBe(value);
      }
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    });
  });

  describe('request target', () => {
    const CRLF = String.fromCharCode(13, 10);

    async function listenOnce(): Promise<number> {
      if (!application.getHttpServer().listening) {
        await application.listen(0, '127.0.0.1');
      }
      return (application.getHttpServer().address() as AddressInfo).port;
    }

    /** Raw HTTP over a socket: inject() normalises the target before the app sees it. */
    function sendRawRequest(port: number, requestText: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => socket.end(requestText));
        let responseText = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => (responseText += chunk));
        socket.on('end', () => resolve(responseText));
        socket.on('error', reject);
      });
    }

    it.each([
      ['an absolute URL', `http://${ALLOWED_HOST}/api/departments`],
      ['an absolute URL with another host', 'HTTP://evil.example/api/departments'],
    ])(
      'rejects %s, which the router would route past the session check',
      async (_label, target) => {
        const port = await listenOnce();

        const responseText = await sendRawRequest(
          port,
          [`GET ${target} HTTP/1.1`, `Host: ${ALLOWED_HOST}`, 'Connection: close', '', ''].join(
            CRLF,
          ),
        );

        expect(responseText.split(CRLF)[0]).toBe('HTTP/1.1 400 Bad Request');
        expect(responseText).toContain('REQUEST_TARGET_NOT_ALLOWED');
        expect(responseText).not.toContain('"departments"');
      },
    );
  });
});
