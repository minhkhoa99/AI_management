import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  SESSION_TOKEN_HEADER,
  TRACE_ID_HEADER,
} from '@aiteam/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiteamApplication } from './app-factory';
import { applyPendingMigrations } from './shared/database/migration-runner';
import { ALL_MIGRATIONS } from './shared/database/migrations';
import {
  IN_MEMORY_DATABASE_LOCATION,
  openSqliteDatabase,
} from './shared/database/sqlite-connection';
import { createAppLogger } from './shared/logging/app-logger';

const SESSION_TOKEN = 'test-session-token-0123456789abcdef0123456789';
const LOOPBACK_HOST = '127.0.0.1:4321';

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

  function sendRequest(url: string, headers: Record<string, string> = {}) {
    return application.inject({ method: 'GET', url, headers: { host: LOOPBACK_HOST, ...headers } });
  }

  it('GET /api/health answers ok without a session token', async () => {
    const response = await sendRequest('/api/health');

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.version).toBe('9.9.9-test');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(3);
    expect(response.headers[TRACE_ID_HEADER]).toEqual(expect.any(String));
  });

  it('rejects API calls without a session token, with traceId in body and header', async () => {
    const response = await sendRequest('/api/departments');

    expect(response.statusCode).toBe(403);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('SESSION_TOKEN_INVALID');
    expect(body.error.traceId).toBe(response.headers[TRACE_ID_HEADER]);
  });

  it('rejects API calls with a wrong session token', async () => {
    const response = await sendRequest('/api/departments', {
      [SESSION_TOKEN_HEADER]: 'wrong-token',
    });

    expect(response.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('SESSION_TOKEN_INVALID');
  });

  it.each(['/%61pi/departments', '/api/departments?x=1', '/api/departments/'])(
    'does not let %s bypass the session token check',
    async (url) => {
      const response = await sendRequest(url);

      expect(response.statusCode).toBe(403);
    },
  );

  it('lets a valid session token through to routing (unknown route → JSON 404)', async () => {
    const response = await sendRequest('/api/departments', {
      [SESSION_TOKEN_HEADER]: SESSION_TOKEN,
    });

    expect(response.statusCode).toBe(404);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(body.error.traceId).toBe(response.headers[TRACE_ID_HEADER]);
  });

  it('never echoes the query string (which may hold the session token) in 404 errors', async () => {
    const response = await sendRequest('/missing-page?token=leaked-secret-value', {
      [SESSION_TOKEN_HEADER]: SESSION_TOKEN,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('leaked-secret-value');
  });

  it('reuses a well-formed incoming trace id', async () => {
    const response = await sendRequest('/api/health', { [TRACE_ID_HEADER]: 'client-trace-12345' });

    expect(response.headers[TRACE_ID_HEADER]).toBe('client-trace-12345');
  });

  it('blocks DNS-rebinding style requests with a foreign Host header', async () => {
    const response = await sendRequest('/api/health', { host: 'evil.example:4321' });

    expect(response.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('serves the static web build at / without a token', async () => {
    const response = await sendRequest('/?token=abc');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<title>AI Team</title>');
  });

  it('also guards the static files against foreign Host headers', async () => {
    const response = await sendRequest('/', { host: 'evil.example' });

    expect(response.statusCode).toBe(403);
  });
});
