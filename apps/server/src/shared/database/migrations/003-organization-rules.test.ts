import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

const migrationsBeforeOrganizationRules = ALL_MIGRATIONS.filter(
  (migration) => migration.version < 3,
);

describe('migration 003 organization rules', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
  });

  afterEach(() => {
    database.close();
  });

  it('maps existing roles case-insensitively and keeps seats attached', () => {
    applyPendingMigrations(database, migrationsBeforeOrganizationRules);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO agents (id, name, role, provider) VALUES ('a1', 'Manager Dev', 'Manager', 'claude_code');
      INSERT INTO positions (id, department_id, title, agent_id) VALUES ('p1', 'dev', 'Manager', 'a1');
    `);

    applyPendingMigrations(database, ALL_MIGRATIONS);

    expect(database.prepare('SELECT role FROM agents').get()).toEqual({ role: 'manager' });
    expect(database.prepare('SELECT agent_id FROM positions').get()).toEqual({ agent_id: 'a1' });
  });

  it('aborts on a role outside the fixed list', () => {
    applyPendingMigrations(database, migrationsBeforeOrganizationRules);
    database.exec(
      "INSERT INTO agents (id, name, role, provider) VALUES ('a1', 'X', 'Chief Vibes Officer', 'codex')",
    );

    expect(() => applyPendingMigrations(database, ALL_MIGRATIONS)).toThrow(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    );
  });

  describe('after migration', () => {
    beforeEach(() => {
      applyPendingMigrations(database, ALL_MIGRATIONS);
      database.exec(`
        INSERT INTO departments (id, name, color) VALUES ('dev', 'Phòng Dev', '#3B82F6');
        INSERT INTO agents (id, name, role, provider) VALUES ('a1', 'Head', 'manager', 'codex');
        INSERT INTO agents (id, name, role, provider) VALUES ('a2', 'Other', 'manager', 'codex');
        INSERT INTO positions (id, department_id, title, agent_id) VALUES ('p1', 'dev', 'manager', 'a1');
      `);
    });

    it('allows only one head (position without a manager) per department', () => {
      expect(() =>
        database
          .prepare(
            "INSERT INTO positions (id, department_id, title, agent_id) VALUES ('p2', 'dev', 'manager', 'a2')",
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
      expect(() =>
        database
          .prepare(
            "INSERT INTO positions (id, department_id, title, reports_to_position_id, agent_id) VALUES ('p2', 'dev', 'manager', 'p1', 'a2')",
          )
          .run(),
      ).not.toThrow();
    });

    it('rejects a department name that differs only in ASCII case', () => {
      expect(() =>
        database
          .prepare(
            "INSERT INTO departments (id, name, color) VALUES ('dev2', 'phòng dev', '#000000')",
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
    });
  });
});
