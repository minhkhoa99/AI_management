import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LevelWithSilent } from 'pino';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAiteamApplication } from './app-factory';
import {
  createNoFreePortError,
  isPortUnusableError,
  isPortAvailable,
  listCandidatePorts,
} from './listen-port';
import { ValidationError } from './shared/errors/app-error';
import { applyPendingMigrations } from './shared/database/migration-runner';
import { ALL_MIGRATIONS } from './shared/database/migrations';
import { openSqliteDatabase } from './shared/database/sqlite-connection';
import { randomUuidGenerator } from './shared/identifiers/id-generator';
import { createAppLogger } from './shared/logging/app-logger';
import { AgentSessionSupervisor } from './shared/runtime/agent-session-supervisor';
import type { LocalEngineAdaptersOverride } from './shared/runtime/local-engine-adapters-override';
import {
  installFatalErrorHandlers,
  SESSION_SHUTDOWN_TIMEOUT_MS,
} from './shared/runtime/fatal-error-handler';

// Re-exported for the launcher (bin/aiteam.mjs, command `aimanagement`), which cannot import TypeScript contracts.
export { DEFAULT_SERVER_PORT, SESSION_QUERY_PARAM } from '@aiteam/contracts';

/** The server only ever binds the loopback interface. */
export const LISTEN_HOST = '127.0.0.1';

const MIN_SESSION_TOKEN_LENGTH = 32;

export interface StartAiteamServerOptions {
  /** Tried first; when busy, the next free port (up to MAX_PORT_ATTEMPTS) is used. */
  preferredPort: number;
  version: string;
  sessionToken: string;
  /** ~/.aiteam/data: holds aiteam.db and, later, patches and QA documents. */
  dataDirectory: string;
  /** ~/.aiteam/logs: holds aiteam.log (JSON lines). */
  logDirectory: string;
  /** Defaults to secret.key next to the data directory (~/.aiteam/secret.key). */
  secretKeyFilePath?: string;
  webRootDirectory?: string;
  logLevel?: LevelWithSilent;
  /**
   * Install process-wide unhandledRejection/uncaughtException handlers (crash report, cancel
   * sessions, exit 1). Only the launcher sets this; tests must not take over the process.
   */
  installFatalErrorHandlers?: boolean;
  /** Tests only: replaces the adapters that spawn the real engine CLIs (never set when running). */
  localEngineAdaptersOverride?: LocalEngineAdaptersOverride;
}

export interface RunningAiteamServer {
  /** Base URL of the port actually bound, without the session token, e.g. http://127.0.0.1:7419 */
  baseUrl: string;
  listenPort: number;
  appliedMigrationVersions: number[];
  stopServer(): Promise<void>;
}

/** Opens the database, applies migrations and starts listening on 127.0.0.1. */
export async function startAiteamServer(
  options: StartAiteamServerOptions,
): Promise<RunningAiteamServer> {
  if (options.sessionToken.length < MIN_SESSION_TOKEN_LENGTH) {
    throw new ValidationError(
      `Session token must be at least ${MIN_SESSION_TOKEN_LENGTH} characters.`,
    );
  }

  const startedAtEpochMs = Date.now();
  // Private to the current user: the database will hold encrypted keys and agent transcripts.
  mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(options.logDirectory, { recursive: true, mode: 0o700 });
  const logger = createAppLogger({
    level: options.logLevel ?? 'info',
    logFilePath: path.join(options.logDirectory, 'aiteam.log'),
  });
  const database = openSqliteDatabase(path.join(options.dataDirectory, 'aiteam.db'));
  const sessionSupervisor = new AgentSessionSupervisor(randomUuidGenerator, logger);
  const uninstallFatalErrorHandlers =
    options.installFatalErrorHandlers === true
      ? installFatalErrorHandlers({
          logger,
          sessionSupervisor,
          crashDirectory: options.logDirectory,
          appVersion: options.version,
          exitProcess: (exitCode) => process.exit(exitCode),
          writeToTerminal: (text) => process.stderr.write(text),
        })
      : () => undefined;

  try {
    const migrationReport = applyPendingMigrations(database, ALL_MIGRATIONS);
    logger.info(migrationReport, 'database migrations checked');

    const { application, listenPort } = await listenOnFirstFreePort(options.preferredPort, (port) =>
      createAiteamApplication({
        runtimeConfig: {
          version: options.version,
          startedAtEpochMs,
          sessionToken: options.sessionToken,
          listenPort: port,
          secretKeyFilePath:
            options.secretKeyFilePath ??
            path.join(path.dirname(options.dataDirectory), 'secret.key'),
          dataDirectory: options.dataDirectory,
        },
        database,
        logger,
        sessionSupervisor,
        webRootDirectory: options.webRootDirectory,
        localEngineAdaptersOverride: options.localEngineAdaptersOverride ?? null,
      }),
    );

    const baseUrl = `http://${LISTEN_HOST}:${listenPort}`;
    logger.info(
      { baseUrl, preferredPort: options.preferredPort, version: options.version },
      'aiteam server listening',
    );

    return {
      baseUrl,
      listenPort,
      appliedMigrationVersions: migrationReport.appliedVersions,
      stopServer: async () => {
        // Same order as a fatal stop: end agent sessions first (bounded), then the server.
        const { unfinishedOwners } = await sessionSupervisor.cancelAllSessions(
          SESSION_SHUTDOWN_TIMEOUT_MS,
        );
        if (unfinishedOwners.length > 0) {
          logger.warn({ unfinishedOwners }, 'sessions still running at shutdown');
        }
        await application.close();
        uninstallFatalErrorHandlers();
        database.close();
        logger.info('aiteam server stopped');
        logger.flush();
      },
    };
  } catch (error) {
    uninstallFatalErrorHandlers();
    logger.fatal({ err: error }, 'aiteam server failed to start');
    logger.flush();
    database.close();
    throw error;
  }
}

/**
 * Binds the first free port starting at preferredPort. The application is built per attempt
 * because Host/Origin checks are tied to the port. A port taken between the probe and listen()
 * (race with another process) is treated like a busy port.
 */
async function listenOnFirstFreePort(
  preferredPort: number,
  buildApplication: (port: number) => Promise<NestFastifyApplication>,
): Promise<{ application: NestFastifyApplication; listenPort: number }> {
  for (const port of listCandidatePorts(preferredPort)) {
    if (!(await isPortAvailable(port, LISTEN_HOST))) {
      continue;
    }
    const application = await buildApplication(port);
    try {
      await application.listen({ port, host: LISTEN_HOST });
      return { application, listenPort: port };
    } catch (error) {
      await application.close();
      if (!isPortUnusableError(error)) {
        throw error;
      }
    }
  }
  throw createNoFreePortError(preferredPort);
}
