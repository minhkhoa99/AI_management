import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

describe('migration 006 workflow step owners', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
  });

  afterEach(() => {
    database.close();
  });

  it('keeps existing steps and their return targets', () => {
    applyPendingMigrations(
      database,
      ALL_MIGRATIONS.filter((migration) => migration.version < 6),
    );
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO workflows (id, department_id, name) VALUES ('flow', 'dev', 'Flow');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail)
        VALUES ('s1', 'flow', 0, 'Code', 'dev', 'tests_pass', 'stop');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id)
        VALUES ('s2', 'flow', 1, 'QC', 'qc', 'qc_pass', 'return_to_step', 's1');
    `);

    applyPendingMigrations(database, ALL_MIGRATIONS);

    expect(
      database
        .prepare('SELECT id, fail_target_step_id FROM workflow_steps ORDER BY position')
        .all(),
    ).toEqual([
      { id: 's1', fail_target_step_id: null },
      { id: 's2', fail_target_step_id: 's1' },
    ]);
  });

  it('lets the user own approval steps only', () => {
    applyPendingMigrations(database, ALL_MIGRATIONS);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO workflows (id, department_id, name) VALUES ('flow', 'dev', 'Flow');
    `);
    const insertStep = (id: string, position: number, gate: string) =>
      database
        .prepare(
          "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail) VALUES (?, 'flow', ?, 'S', 'user', ?, 'stop')",
        )
        .run(id, position, gate);

    expect(() => insertStep('approve', 0, 'user_approval')).not.toThrow();
    expect(() => insertStep('work', 1, 'auto')).toThrow(/CHECK constraint failed/);
  });

  it('refuses to remove a step that another step returns to, but deletes whole workflows', () => {
    applyPendingMigrations(database, ALL_MIGRATIONS);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO workflows (id, department_id, name) VALUES ('flow', 'dev', 'Flow');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail)
        VALUES ('s1', 'flow', 0, 'Code', 'dev', 'auto', 'stop');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id)
        VALUES ('s2', 'flow', 1, 'QC', 'qc', 'qc_pass', 'return_to_step', 's1');
    `);

    expect(() => database.exec("DELETE FROM workflow_steps WHERE id = 's1'")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    database.exec("DELETE FROM workflows WHERE id = 'flow'");
    expect(database.prepare('SELECT COUNT(*) AS remaining FROM workflow_steps').get()).toEqual({
      remaining: 0,
    });
  });
});
