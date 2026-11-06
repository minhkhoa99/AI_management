import type { DatabaseSync } from 'node:sqlite';
import { MigrationFailedError } from './migration-failed.error';
import type { SqlMigration } from './sql-migration';

export interface MigrationReport {
  appliedVersions: number[];
  currentVersion: number;
}

const CREATE_MIGRATION_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`;

/**
 * Applies every migration whose version is not yet recorded, in ascending order. Each migration
 * and its history row commit atomically, so a failure leaves the schema at the previous version.
 */
export function applyPendingMigrations(
  database: DatabaseSync,
  migrations: readonly SqlMigration[],
): MigrationReport {
  assertMigrationsAreOrdered(migrations);
  database.exec(CREATE_MIGRATION_HISTORY_TABLE_SQL);

  const recordedVersions = readRecordedVersions(database);
  assertDatabaseIsNotNewerThanApp(recordedVersions, migrations);

  const appliedVersions: number[] = [];
  const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
  );

  for (const migration of migrations) {
    if (recordedVersions.has(migration.version)) {
      continue;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      recordMigration.run(migration.version, migration.name);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new MigrationFailedError(
        'MIGRATION_FAILED',
        `Migration ${formatMigrationLabel(migration)} failed; schema left at previous version.`,
        error,
      );
    }
    appliedVersions.push(migration.version);
  }

  const lastMigration = migrations.at(-1);
  return { appliedVersions, currentVersion: lastMigration?.version ?? 0 };
}

function assertMigrationsAreOrdered(migrations: readonly SqlMigration[]): void {
  migrations.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new MigrationFailedError(
        'MIGRATION_DEFINITION_INVALID',
        `Migration ${formatMigrationLabel(migration)} must have a positive integer version.`,
      );
    }
    const previous = migrations[index - 1];
    if (previous !== undefined && migration.version <= previous.version) {
      throw new MigrationFailedError(
        'MIGRATION_DEFINITION_INVALID',
        `Migration versions must be strictly ascending: ${formatMigrationLabel(previous)} then ${formatMigrationLabel(migration)}.`,
      );
    }
  });
}

function readRecordedVersions(database: DatabaseSync): Set<number> {
  const rows = database.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => Number(row.version)));
}

function assertDatabaseIsNotNewerThanApp(
  recordedVersions: ReadonlySet<number>,
  migrations: readonly SqlMigration[],
): void {
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const unknownVersions = [...recordedVersions].filter((version) => !knownVersions.has(version));
  if (unknownVersions.length > 0) {
    throw new MigrationFailedError(
      'DATABASE_NEWER_THAN_APP',
      `Database contains migrations unknown to this version of aiteam (${unknownVersions.join(', ')}). Update aiteam.`,
    );
  }
}

function formatMigrationLabel(migration: SqlMigration): string {
  return `${String(migration.version).padStart(3, '0')}-${migration.name}`;
}
