import { mkdtempSync, rmSync } from 'node:fs';
import type { AgentEnginePort } from '../modules/orchestration/application/ports/agent-engine.port';
import type { LocalEngineAdaptersOverride } from '../shared/runtime/local-engine-adapters-override';
import type { DirectoryPicker } from '../shared/runtime/directory-picker';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOCAL_ENGINES, SESSION_COOKIE_NAME } from '@aiteam/contracts';
import { createAiteamApplication } from '../app-factory';
import { CLAUDE_CODE_MODEL_CHOICES } from '../modules/providers/domain/claude-code-models';
import { applyPendingMigrations } from '../shared/database/migration-runner';
import { ALL_MIGRATIONS } from '../shared/database/migrations';
import {
  IN_MEMORY_DATABASE_LOCATION,
  openSqliteDatabase,
} from '../shared/database/sqlite-connection';
import { createAppLogger } from '../shared/logging/app-logger';
import type { ProcessInspector } from '../shared/runtime/process-identity';
import type { ProcessTerminator } from '../shared/runtime/process-termination';
import { AgentSessionSupervisor } from '../shared/runtime/agent-session-supervisor';
import { SESSION_SHUTDOWN_TIMEOUT_MS } from '../shared/runtime/fatal-error-handler';

export const TEST_SESSION_TOKEN = 'test-session-token-0123456789abcdef0123456789';
export const TEST_LISTEN_PORT = 7419;

export const DEFAULT_FAKE_LOCAL_ENGINES: LocalEngineAdaptersOverride = {
  probe: {
    probeLocalEngine: () =>
      Promise.resolve({
        installed: false,
        version: null,
        signedIn: null,
        accountDetail: null,
        problem: 'Not installed (test double).',
      }),
  },
  claudeModelCatalog: { listClaudeModels: () => Promise.resolve([...CLAUDE_CODE_MODEL_CHOICES]) },
  codexModelCatalog: { listCodexModels: () => Promise.resolve([]) },
  antigravityModelCatalog: { listAntigravityModels: () => Promise.resolve([]) },
  quotaReaders: LOCAL_ENGINES.map((engine) => ({
    engine,
    readEngineQuota: () => Promise.resolve({ state: 'not_installed' as const, buckets: [] }),
  })),
  cliUpdateChecker: { findCliUpdate: () => Promise.resolve(null) },
};

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
  /** Sends raw bytes (application/octet-stream), like a file upload from the UI. */
  uploadBytes(method: HttpMethod, url: string, content: Buffer): Promise<TestApiResponse>;
  /** Folder used as the data directory (QA documents live under it). */
  dataDirectory: string;
  closeApplication(): Promise<void>;
}

/** Full Nest application (all modules, middleware, filter) on a SQLite database. */
export interface TestApplicationOverrides {
  processInspector?: ProcessInspector;
  processTerminator?: ProcessTerminator;
  directoryPicker?: DirectoryPicker;
  agentEngineOverride?: AgentEnginePort;
  localEngineAdaptersOverride?: LocalEngineAdaptersOverride;
}

export async function startTestApplication(
  databaseLocation = IN_MEMORY_DATABASE_LOCATION,
  overrides: TestApplicationOverrides = {},
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
      dataDirectory: secretDirectory,
    },
    database,
    logger: createAppLogger({ level: 'silent' }),
    // Tests never inspect or kill real processes unless they say so.
    processInspector: overrides.processInspector ?? { inspectProcess: () => Promise.resolve(null) },
    processTerminator: overrides.processTerminator ?? { terminateProcessTree: () => undefined },
    // Never opens a real dialog: tests behave as if the user cancelled unless they say so.
    directoryPicker: overrides.directoryPicker ?? { pickDirectory: () => Promise.resolve(null) },
    agentEngineOverride: overrides.agentEngineOverride ?? null,
    // Default fakes: probing and model catalogs never spawn the developer's installed CLIs.
    localEngineAdaptersOverride:
      overrides.localEngineAdaptersOverride ?? DEFAULT_FAKE_LOCAL_ENGINES,
    // Tasks only run in tests that script the engine: never a real CLI.
    taskSchedulerEnabled: overrides.agentEngineOverride !== undefined,
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
    async uploadBytes(method, url, content) {
      const response = await application.inject({
        method,
        url,
        headers: {
          host: `127.0.0.1:${TEST_LISTEN_PORT}`,
          origin: `http://127.0.0.1:${TEST_LISTEN_PORT}`,
          cookie: `${SESSION_COOKIE_NAME}=${TEST_SESSION_TOKEN}`,
          'content-type': 'application/octet-stream',
        },
        payload: content,
      });
      return {
        statusCode: response.statusCode,
        body: response.body.length === 0 ? undefined : (response.json() as unknown),
      };
    },
    dataDirectory: secretDirectory,
    async closeApplication() {
      // Same order as the real server's stop: end agent sessions first, so no turn is still
      // writing (git checkpoint) in the data folder when it is removed.
      await application.get(AgentSessionSupervisor).cancelAllSessions(SESSION_SHUTDOWN_TIMEOUT_MS);
      await application.close();
      database.close();
      rmSync(secretDirectory, { recursive: true, force: true });
    },
  };
}
