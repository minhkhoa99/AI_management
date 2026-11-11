import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

describe('migration 014 task review pending', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(
      database,
      ALL_MIGRATIONS.filter((migration) => migration.version < 14),
    );
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO tasks (id, department_id, title, priority, status)
        VALUES ('t1', 'dev', 'Có sẵn', 2, 'queued');
    `);
  });

  afterEach(() => {
    database.close();
  });

  function migrateToLatest(): void {
    applyPendingMigrations(database, ALL_MIGRATIONS);
  }

  it('gives existing tasks no pending review', () => {
    migrateToLatest();

    expect(database.prepare("SELECT review_pending FROM tasks WHERE id = 't1'").get()).toEqual({
      review_pending: 0,
    });
  });

  it('accepts 0 and 1 and rejects any other value', () => {
    migrateToLatest();

    database.prepare("UPDATE tasks SET review_pending = 1 WHERE id = 't1'").run();
    expect(database.prepare("SELECT review_pending FROM tasks WHERE id = 't1'").get()).toEqual({
      review_pending: 1,
    });
    expect(() =>
      database.prepare("UPDATE tasks SET review_pending = 2 WHERE id = 't1'").run(),
    ).toThrow(/CHECK constraint failed/);
  });
});
