import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

describe('migration 015 department handoff', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(
      database,
      ALL_MIGRATIONS.filter((migration) => migration.version < 15),
    );
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO departments (id, name, color) VALUES ('review', 'Review', '#22C55E');
      INSERT INTO workflows (id, department_id, name) VALUES ('flow', 'dev', 'Flow');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail)
        VALUES ('s1', 'flow', 0, 'Code', 'dev', 'tests_pass', 'stop');
      INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id)
        VALUES ('s2', 'flow', 1, 'QC', 'qc', 'qc_pass', 'return_to_step', 's1');
      INSERT INTO tasks (id, department_id, title, priority, status)
        VALUES ('t1', 'dev', 'Có sẵn', 2, 'queued');
    `);
    applyPendingMigrations(database, ALL_MIGRATIONS);
  });

  afterEach(() => {
    database.close();
  });

  const insertStep = (
    id: string,
    position: number,
    owner: string,
    gate: string,
    onFail: string,
    target: string | null,
    maxRetries = 0,
  ) =>
    database
      .prepare(
        `INSERT INTO workflow_steps
           (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id,
            max_retries, handoff_department_id)
         VALUES (?, 'flow', ?, 'S', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        position,
        owner,
        gate,
        onFail,
        onFail === 'return_to_step' ? 's1' : null,
        maxRetries,
        target,
      );

  it('keeps existing steps and return targets, with no handoffs', () => {
    expect(
      database
        .prepare(
          'SELECT id, fail_target_step_id, handoff_department_id FROM workflow_steps ORDER BY position',
        )
        .all(),
    ).toEqual([
      { id: 's1', fail_target_step_id: null, handoff_department_id: null },
      { id: 's2', fail_target_step_id: 's1', handoff_department_id: null },
    ]);
    expect(database.prepare("SELECT handoff_task_id FROM tasks WHERE id = 't1'").get()).toEqual({
      handoff_task_id: null,
    });
  });

  it('accepts an automatic handoff step that returns to an earlier step', () => {
    expect(() =>
      insertStep('h', 2, 'department', 'auto', 'return_to_step', 'review'),
    ).not.toThrow();
  });

  it.each([
    ['without a target department', 'department', 'auto', 'stop', null, 0],
    ['with a target on an agent step', 'dev', 'auto', 'stop', 'review', 0],
    ['with another gate', 'department', 'qc_pass', 'stop', 'review', 0],
    ['that retries', 'department', 'auto', 'retry', 'review', 1],
  ] as const)('refuses a step %s', (_label, owner, gate, onFail, target, maxRetries) => {
    expect(() => insertStep('h', 2, owner, gate, onFail, target, maxRetries)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('blocks deleting a target department, not the department owning the step', () => {
    insertStep('h', 2, 'department', 'auto', 'return_to_step', 'review');

    expect(() => database.exec("DELETE FROM departments WHERE id = 'review'")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    database.exec("DELETE FROM tasks WHERE id = 't1'");
    expect(() => database.exec("DELETE FROM departments WHERE id = 'dev'")).not.toThrow();
  });
});
