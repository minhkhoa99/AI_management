import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

const [initialSchema] = ALL_MIGRATIONS;

describe('migration 002 on a database with existing rows', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    if (initialSchema === undefined) {
      throw new Error('migration 001 missing');
    }
    applyPendingMigrations(database, [initialSchema]);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO provider_connections (id, name, format, base_url) VALUES ('conn', 'Local', 'openai', 'http://x');
      INSERT INTO agents (id, name, role, provider, connection_id, permission_mode)
        VALUES ('a1', 'Builder', 'dev', 'custom', 'conn', NULL);
      INSERT INTO positions (id, department_id, title, agent_id) VALUES ('p1', 'dev', 'Dev', 'a1');
      INSERT INTO tasks (id, department_id, title, priority, assignee_agent_id) VALUES ('t1', 'dev', 'Task', '2', 'a1');
      INSERT INTO task_events (task_id, trace_id, agent_id, kind) VALUES ('t1', 'trace-1', 'a1', 'message');
    `);
  });

  afterEach(() => {
    database.close();
  });

  it('keeps child rows (no cascade while rebuilding parent tables) and maps renamed values', () => {
    applyPendingMigrations(database, ALL_MIGRATIONS);

    expect(database.prepare('SELECT * FROM agents').all()).toEqual([
      {
        id: 'a1',
        name: 'Builder',
        role: 'dev',
        provider: 'custom_api',
        connection_id: 'conn',
        model: null,
        access_level: 'read_only',
        network_access: 0,
        enabled: 1,
      },
    ]);
    expect(database.prepare('SELECT agent_id FROM positions').get()).toEqual({ agent_id: 'a1' });
    expect(database.prepare('SELECT priority, assignee_agent_id FROM tasks').get()).toEqual({
      priority: 2,
      assignee_agent_id: 'a1',
    });
    expect(database.prepare('SELECT COUNT(*) AS eventCount FROM task_events').get()).toEqual({
      eventCount: 1,
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('keeps foreign keys enforced on the rebuilt tables', () => {
    applyPendingMigrations(database, ALL_MIGRATIONS);

    expect(() =>
      database
        .prepare(
          "INSERT INTO tasks (id, department_id, title, priority) VALUES ('t2', 'missing', 'Task', 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('aborts instead of guessing when an old value has no mapping', () => {
    database.exec("UPDATE tasks SET priority = 'urgent' WHERE id = 't1'");

    expect(() => applyPendingMigrations(database, ALL_MIGRATIONS)).toThrow(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    );
    expect(database.prepare('SELECT priority FROM tasks').get()).toEqual({ priority: 'urgent' });
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual(
      { version: 1 },
    );
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });
});
