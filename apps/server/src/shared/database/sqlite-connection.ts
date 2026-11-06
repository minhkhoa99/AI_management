import { DatabaseSync } from 'node:sqlite';

export const SQLITE_DATABASE = Symbol('SQLITE_DATABASE');

/** In-memory location accepted by node:sqlite; used by tests. */
export const IN_MEMORY_DATABASE_LOCATION = ':memory:';

/**
 * Opens the single SQLite connection used by the whole process: WAL journal (readers never block
 * the writer), foreign keys enforced, and a busy timeout instead of failing on a locked file.
 */
export function openSqliteDatabase(location: string): DatabaseSync {
  const database = new DatabaseSync(location, { enableForeignKeyConstraints: true });
  if (location !== IN_MEMORY_DATABASE_LOCATION) {
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = NORMAL');
  }
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  return database;
}
