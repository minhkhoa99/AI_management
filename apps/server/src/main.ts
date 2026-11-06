import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LevelWithSilent } from 'pino';
import { createAiteamApplication } from './app-factory';
import { ValidationError } from './shared/errors/app-error';
import { applyPendingMigrations } from './shared/database/migration-runner';
import { ALL_MIGRATIONS } from './shared/database/migrations';
import { openSqliteDatabase } from './shared/database/sqlite-connection';
import { createAppLogger } from './shared/logging/app-logger';

/** The server only ever binds the loopback interface. */
export const LISTEN_HOST = '127.0.0.1';

const MIN_SESSION_TOKEN_LENGTH = 32;

export interface StartAiteamServerOptions {
  port: number;
  version: string;
  sessionToken: string;
  /** ~/.aiteam/data: holds aiteam.db and, later, patches and QA documents. */
  dataDirectory: string;
  /** ~/.aiteam/logs: holds aiteam.log (JSON lines). */
  logDirectory: string;
  webRootDirectory?: string;
  logLevel?: LevelWithSilent;
}

export interface RunningAiteamServer {
  /** Base URL without the session token, e.g. http://127.0.0.1:4321 */
  baseUrl: string;
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

  try {
    const migrationReport = applyPendingMigrations(database, ALL_MIGRATIONS);
    logger.info(migrationReport, 'database migrations checked');

    const application = await createAiteamApplication({
      runtimeConfig: {
        version: options.version,
        startedAtEpochMs,
        sessionToken: options.sessionToken,
      },
      database,
      logger,
      webRootDirectory: options.webRootDirectory,
    });
    await application.listen({ port: options.port, host: LISTEN_HOST });

    const baseUrl = `http://${LISTEN_HOST}:${options.port}`;
    logger.info({ baseUrl, version: options.version }, 'aiteam server listening');

    return {
      baseUrl,
      appliedMigrationVersions: migrationReport.appliedVersions,
      stopServer: async () => {
        await application.close();
        database.close();
        logger.info('aiteam server stopped');
        logger.flush();
      },
    };
  } catch (error) {
    logger.fatal({ err: error }, 'aiteam server failed to start');
    logger.flush();
    database.close();
    throw error;
  }
}
