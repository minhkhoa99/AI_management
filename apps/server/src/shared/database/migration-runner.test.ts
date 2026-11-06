import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error';
import { applyPendingMigrations } from './migration-runner';
import { ALL_MIGRATIONS } from './migrations';
import type { SqlMigration } from './sql-migration';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from './sqlite-connection';

const createNotesTable: SqlMigration = {
  version: 1,
  name: 'create-notes',
  sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
};
const addNotesAuthor: SqlMigration = {
  version: 2,
  name: 'add-notes-author',
  sql: 'ALTER TABLE notes ADD COLUMN author TEXT',
};

function listTableNames(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function listRecordedVersions(database: DatabaseSync): number[] {
  const rows = database
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{
    version: number;
  }>;
  return rows.map((row) => Number(row.version));
}

describe('applyPendingMigrations', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
  });

  afterEach(() => {
    database.close();
  });

  it('applies every migration in order on an empty database', () => {
    const report = applyPendingMigrations(database, [createNotesTable, addNotesAuthor]);

    expect(report).toEqual({ appliedVersions: [1, 2], currentVersion: 2 });
    expect(listRecordedVersions(database)).toEqual([1, 2]);
    database
      .prepare('INSERT INTO notes (id, body, author) VALUES (?, ?, ?)')
      .run('n1', 'hello', 'khoa');
  });

  it('is idempotent: a second run applies nothing', () => {
    applyPendingMigrations(database, [createNotesTable, addNotesAuthor]);
    const secondReport = applyPendingMigrations(database, [createNotesTable, addNotesAuthor]);

    expect(secondReport.appliedVersions).toEqual([]);
    expect(listRecordedVersions(database)).toEqual([1, 2]);
  });

  it('applies only the new migrations after an upgrade', () => {
    applyPendingMigrations(database, [createNotesTable]);
    const report = applyPendingMigrations(database, [createNotesTable, addNotesAuthor]);

    expect(report.appliedVersions).toEqual([2]);
  });

  it('rolls back a failing migration and leaves earlier ones committed', () => {
    const brokenMigration: SqlMigration = {
      version: 2,
      name: 'broken',
      sql: 'CREATE TABLE half_done (id TEXT); INSERT INTO table_that_does_not_exist VALUES (1);',
    };

    expect(() => applyPendingMigrations(database, [createNotesTable, brokenMigration])).toThrow(
      expect.objectContaining({ code: 'MIGRATION_FAILED', retryable: false }),
    );
    expect(listRecordedVersions(database)).toEqual([1]);
    expect(listTableNames(database)).not.toContain('half_done');
  });

  it('wraps the SQLite error as the cause', () => {
    const brokenMigration: SqlMigration = { version: 1, name: 'syntax', sql: 'CREATE TABLEX nope' };

    try {
      applyPendingMigrations(database, [brokenMigration]);
      expect.unreachable('migration should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).cause).toBeInstanceOf(Error);
    }
  });

  it('rolls back a table rebuild that leaves foreign key violations and restores enforcement', () => {
    database.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY);
      CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents (id) ON DELETE CASCADE);
      INSERT INTO parents VALUES ('p1');
      INSERT INTO children VALUES ('c1', 'p1');
    `);
    const rebuildLosingParent: SqlMigration = {
      version: 1,
      name: 'rebuild-parents-badly',
      rebuildsTables: true,
      sql: `
        CREATE TABLE parents_rebuilt (id TEXT PRIMARY KEY);
        DROP TABLE parents;
        ALTER TABLE parents_rebuilt RENAME TO parents;
      `,
    };

    expect(() => applyPendingMigrations(database, [rebuildLosingParent])).toThrow(
      expect.objectContaining({ code: 'MIGRATION_FOREIGN_KEY_VIOLATION' }),
    );
    expect(database.prepare('SELECT id FROM parents').all()).toEqual([{ id: 'p1' }]);
    expect(database.prepare('SELECT id FROM children').all()).toEqual([{ id: 'c1' }]);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('rejects migrations that are not strictly ascending', () => {
    expect(() => applyPendingMigrations(database, [addNotesAuthor, createNotesTable])).toThrow(
      expect.objectContaining({ code: 'MIGRATION_DEFINITION_INVALID' }),
    );
    expect(() =>
      applyPendingMigrations(database, [createNotesTable, { ...addNotesAuthor, version: 1 }]),
    ).toThrow(expect.objectContaining({ code: 'MIGRATION_DEFINITION_INVALID' }));
  });

  it('refuses to run an older app against a newer database', () => {
    applyPendingMigrations(database, [createNotesTable, addNotesAuthor]);

    expect(() => applyPendingMigrations(database, [createNotesTable])).toThrow(
      expect.objectContaining({ code: 'DATABASE_NEWER_THAN_APP' }),
    );
  });
});

describe('migration 001 initial schema', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(database, ALL_MIGRATIONS);
  });

  afterEach(() => {
    database.close();
  });

  it('creates every table from section 4 of the plan', () => {
    expect(listTableNames(database)).toEqual(
      [
        'agents',
        'approvals',
        'checkpoints',
        'departments',
        'line_comments',
        'positions',
        'provider_connections',
        'schema_migrations',
        'task_attachments',
        'task_events',
        'tasks',
        'workflow_steps',
        'workflows',
      ].sort(),
    );
  });

  it('enforces foreign keys', () => {
    expect(() =>
      database
        .prepare('INSERT INTO positions (id, department_id, title) VALUES (?, ?, ?)')
        .run('p1', 'missing-department', 'Manager'),
    ).toThrow(/FOREIGN KEY/);
  });

  it('enforces the task status state set', () => {
    database
      .prepare("INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6')")
      .run();
    const insertTask = database.prepare(
      "INSERT INTO tasks (id, department_id, title, priority, status) VALUES (?, 'dev', 'Task', 1, ?)",
    );

    insertTask.run('t1', 'waiting_approval');
    expect(() => insertTask.run('t2', 'done')).toThrow(/CHECK/);
  });
});
