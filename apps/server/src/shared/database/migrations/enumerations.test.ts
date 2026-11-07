import type { DatabaseSync } from 'node:sqlite';
import {
  ACCESS_LEVELS,
  AGENT_ROLES,
  AGENT_PROVIDERS,
  API_FORMATS,
  LOCAL_ENGINES,
  STEP_FAILURE_ACTIONS,
  STEP_GATES,
  STEP_OWNERS,
  STEP_RETRY_LIMITS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TEAM_MODES,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

type SqlValue = string | number | null;

interface EnumeratedColumn {
  table: string;
  column: string;
  contractValues: readonly SqlValue[];
  invalidValue: SqlValue;
  /** Inserts one row whose `column` is `value`; every other column gets a valid value. */
  insertRowWith: (database: DatabaseSync, value: SqlValue, rowId: string) => void;
}

function seedParentRows(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO departments (id, name, color) VALUES ('dept', 'Dev', '#3B82F6');
    INSERT INTO provider_connections (id, name, format, base_url) VALUES ('conn', 'Local', 'openai', 'http://127.0.0.1:1234');
    INSERT INTO workflows (id, department_id, name) VALUES ('flow', 'dept', 'Default');
  `);
}

const ENUMERATED_COLUMNS: EnumeratedColumn[] = [
  {
    table: 'departments',
    column: 'team_mode',
    contractValues: TEAM_MODES,
    invalidValue: 'solo',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare("INSERT INTO departments (id, name, color, team_mode) VALUES (?, ?, '#000', ?)")
        .run(rowId, rowId, value),
  },
  {
    table: 'agents',
    column: 'provider',
    contractValues: AGENT_PROVIDERS,
    invalidValue: 'custom',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO agents (id, name, role, provider, connection_id) VALUES (?, 'A', 'dev', ?, 'conn')",
        )
        .run(rowId, value),
  },
  {
    table: 'agents',
    column: 'role',
    contractValues: AGENT_ROLES,
    invalidValue: 'Manager',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare("INSERT INTO agents (id, name, role, provider) VALUES (?, 'A', ?, 'codex')")
        .run(rowId, value),
  },
  {
    table: 'agents',
    column: 'access_level',
    contractValues: ACCESS_LEVELS,
    invalidValue: 'admin',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO agents (id, name, role, provider, access_level) VALUES (?, 'A', 'dev', 'codex', ?)",
        )
        .run(rowId, value),
  },
  {
    table: 'agents',
    column: 'network_access',
    contractValues: [0, 1],
    invalidValue: 2,
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO agents (id, name, role, provider, network_access) VALUES (?, 'A', 'dev', 'codex', ?)",
        )
        .run(rowId, value),
  },
  {
    table: 'provider_connections',
    column: 'format',
    contractValues: API_FORMATS,
    invalidValue: 'gemini',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO provider_connections (id, name, format, base_url) VALUES (?, 'C', ?, 'http://x')",
        )
        .run(rowId, value),
  },
  {
    table: 'local_engine_settings',
    column: 'engine',
    contractValues: LOCAL_ENGINES,
    invalidValue: 'gemini_cli',
    insertRowWith: (database, value) => {
      // Rows for every engine are seeded by migration 004: re-insert after removing the seed.
      database.prepare('DELETE FROM local_engine_settings WHERE engine = ?').run(value);
      database.prepare('INSERT INTO local_engine_settings (engine) VALUES (?)').run(value);
    },
  },
  {
    table: 'tasks',
    column: 'priority',
    contractValues: TASK_PRIORITIES,
    invalidValue: 4,
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO tasks (id, department_id, title, priority) VALUES (?, 'dept', 'T', ?)",
        )
        .run(rowId, value),
  },
  {
    table: 'tasks',
    column: 'status',
    contractValues: TASK_STATUSES,
    invalidValue: 'done',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO tasks (id, department_id, title, priority, status) VALUES (?, 'dept', 'T', 2, ?)",
        )
        .run(rowId, value),
  },
  {
    table: 'workflow_steps',
    column: 'gate',
    contractValues: STEP_GATES,
    invalidValue: 'manual',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail) VALUES (?, 'flow', ?, 'S', 'dev', ?, 'stop')",
        )
        .run(rowId, nextStepPosition(), value),
  },
  {
    table: 'workflow_steps',
    column: 'owner_role',
    contractValues: STEP_OWNERS,
    invalidValue: 'Bạn',
    insertRowWith: (database, value, rowId) =>
      database
        .prepare(
          "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail) VALUES (?, 'flow', ?, 'S', ?, 'user_approval', 'stop')",
        )
        .run(rowId, nextStepPosition(), value),
  },
  {
    table: 'workflow_steps',
    column: 'on_fail',
    contractValues: STEP_FAILURE_ACTIONS,
    invalidValue: 'ignore',
    insertRowWith: (database, value, rowId) => {
      // Satisfy the combined CHECKs so only the enumeration itself is under test.
      const targetStepId = value === 'return_to_step' ? insertStopStep(database) : null;
      const maxRetries = value === 'retry' ? STEP_RETRY_LIMITS.min : 0;
      database
        .prepare(
          "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries) VALUES (?, 'flow', ?, 'S', 'dev', 'auto', ?, ?, ?)",
        )
        .run(rowId, nextStepPosition(), value, targetStepId, maxRetries);
    },
  },
];

let stepPositionCounter = 0;
function nextStepPosition(): number {
  stepPositionCounter += 1;
  return stepPositionCounter;
}

function insertStopStep(database: DatabaseSync): string {
  const stepId = `target-${nextStepPosition()}`;
  database
    .prepare(
      "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail) VALUES (?, 'flow', ?, 'Target', 'dev', 'auto', 'stop')",
    )
    .run(stepId, nextStepPosition());
  return stepId;
}

/** Values listed in `CHECK (<column> IN (...))` of the table's stored CREATE statement. */
function readCheckedValues(database: DatabaseSync, table: string, column: string): SqlValue[] {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  const checkPattern = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`);
  const match = checkPattern.exec(row?.sql ?? '');
  if (match?.[1] === undefined) {
    throw new Error(`No CHECK (${column} IN (...)) found on ${table}`);
  }
  return match[1].split(',').map((rawValue) => {
    const trimmed = rawValue.trim();
    return trimmed.startsWith("'") ? trimmed.slice(1, -1) : Number(trimmed);
  });
}

describe('enumerated columns match packages/contracts', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(database, ALL_MIGRATIONS);
    seedParentRows(database);
  });

  afterEach(() => {
    database.close();
  });

  describe.each(ENUMERATED_COLUMNS)('$table.$column', (enumeratedColumn) => {
    it('accepts every value defined in contracts', () => {
      enumeratedColumn.contractValues.forEach((value, index) => {
        expect(() =>
          enumeratedColumn.insertRowWith(database, value, `valid-${index}`),
        ).not.toThrow();
      });
    });

    it(`rejects ${String(enumeratedColumn.invalidValue)}`, () => {
      expect(() =>
        enumeratedColumn.insertRowWith(database, enumeratedColumn.invalidValue, 'invalid'),
      ).toThrow(/CHECK constraint failed/);
    });

    it('declares exactly the contract values in its CHECK constraint', () => {
      expect(
        readCheckedValues(database, enumeratedColumn.table, enumeratedColumn.column).sort(),
      ).toEqual([...enumeratedColumn.contractValues].sort());
    });
  });
});

describe('workflow step failure rules', () => {
  let database: DatabaseSync;
  const insertStep = (onFail: string, failTargetStepId: string | null, maxRetries: number) =>
    database
      .prepare(
        "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries) VALUES (?, 'flow', ?, 'S', 'dev', 'auto', ?, ?, ?)",
      )
      .run(`step-${nextStepPosition()}`, nextStepPosition(), onFail, failTargetStepId, maxRetries);

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(database, ALL_MIGRATIONS);
    seedParentRows(database);
  });

  afterEach(() => {
    database.close();
  });

  it('requires a target step for return_to_step', () => {
    expect(() => insertStep('return_to_step', null, 0)).toThrow(/CHECK constraint failed/);
    expect(() => insertStep('return_to_step', insertStopStep(database), 0)).not.toThrow();
  });

  it.each(['retry', 'stop'])('forbids a target step for %s', (onFail) => {
    expect(() => insertStep(onFail, insertStopStep(database), 1)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('allows retry only with 1 to 5 retries', () => {
    expect(() => insertStep('retry', null, 0)).toThrow(/CHECK constraint failed/);
    expect(() => insertStep('retry', null, STEP_RETRY_LIMITS.min)).not.toThrow();
    expect(() => insertStep('retry', null, STEP_RETRY_LIMITS.max)).not.toThrow();
    expect(() => insertStep('retry', null, STEP_RETRY_LIMITS.max + 1)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('requires gate and on_fail', () => {
    expect(() =>
      database
        .prepare(
          "INSERT INTO workflow_steps (id, workflow_id, position, name, owner_role) VALUES ('s', 'flow', 999, 'S', 'dev')",
        )
        .run(),
    ).toThrow(/NOT NULL constraint failed/);
  });
});
