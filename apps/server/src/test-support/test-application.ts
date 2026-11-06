import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SESSION_COOKIE_NAME } from '@aiteam/contracts';
import { createAiteamApplication } from '../app-factory';
import { applyPendingMigrations } from '../shared/database/migration-runner';
import { ALL_MIGRATIONS } from '../shared/database/migrations';
import {
  IN_MEMORY_DATABASE_LOCATION,
  openSqliteDatabase,
} from '../shared/database/sqlite-connection';
import { createAppLogger } from '../shared/logging/app-logger';

export const TEST_SESSION_TOKEN = 'test-session-token-0123456789abcdef0123456789';
export const TEST_LISTEN_PORT = 7419;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TestApiResponse {
  statusCode: number;
  body: unknown;
}

export interface TestApplication {
  database: DatabaseSync;
  application: NestFastifyApplication;
  /** Sends a request the way the logged-in UI does: session cookie, same-origin Origin, JSON. */
  callApi(method: HttpMethod, url: string, requestBody?: unknown): Promise<TestApiResponse>;
  closeApplication(): Promise<void>;
}

/** Full Nest application (all modules, middleware, filter) on a SQLite database. */
export async function startTestApplication(
  databaseLocation = IN_MEMORY_DATABASE_LOCATION,
): Promise<TestApplication> {
  const secretDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-test-secret-'));
  const database = openSqliteDatabase(databaseLocation);
  applyPendingMigrations(database, ALL_MIGRATIONS);
  const application: NestFastifyApplication = await createAiteamApplication({
    runtimeConfig: {
      version: '0.0.0-test',
      startedAtEpochMs: Date.now(),
      sessionToken: TEST_SESSION_TOKEN,
      listenPort: TEST_LISTEN_PORT,
      secretKeyFilePath: path.join(secretDirectory, 'secret.key'),
    },
    database,
    logger: createAppLogger({ level: 'silent' }),
  });

  return {
    database,
    application,
    async callApi(method, url, requestBody) {
      const response = await application.inject({
        method,
        url,
        headers: {
          host: `127.0.0.1:${TEST_LISTEN_PORT}`,
          origin: `http://127.0.0.1:${TEST_LISTEN_PORT}`,
          cookie: `${SESSION_COOKIE_NAME}=${TEST_SESSION_TOKEN}`,
          ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(requestBody === undefined ? {} : { payload: JSON.stringify(requestBody) }),
      });
      return {
        statusCode: response.statusCode,
        body: response.body.length === 0 ? undefined : (response.json() as unknown),
      };
    },
    async closeApplication() {
      await application.close();
      database.close();
      rmSync(secretDirectory, { recursive: true, force: true });
    },
  };
}
