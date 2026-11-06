import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_WORKFLOW_RULES,
  type StepFailureAction,
  type StepGate,
  type StepOwner,
  type WorkflowRules,
  workflowRulesSchema,
} from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { Workflow, type WorkflowStepState } from '../../domain/entities/workflow';
import type { WorkflowRepository } from '../../domain/repositories/workflow.repository';

interface WorkflowRow {
  id: string;
  department_id: string;
  name: string;
  description: string;
  is_default: number;
  enforce: number;
  rules_json: string;
}

interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  name: string;
  owner_role: StepOwner;
  gate: StepGate;
  on_fail: StepFailureAction;
  fail_target_step_id: string | null;
  max_retries: number;
  required_output: string | null;
}

const WORKFLOW_COLUMNS = 'id, department_id, name, description, is_default, enforce, rules_json';
const STEP_COLUMNS =
  'id, workflow_id, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output';
/** Kept steps park above this position while the chain is rewritten (UNIQUE workflow_id, position). */
const PARKED_POSITION_OFFSET = 100_000;

@Injectable()
export class SqliteWorkflowRepository implements WorkflowRepository {
  private readonly selectByDepartmentStatement: StatementSync;
  private readonly selectByIdStatement: StatementSync;
  private readonly selectStepsStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly parkStepsStatement: StatementSync;
  private readonly deleteStepStatement: StatementSync;
  private readonly insertStepStatement: StatementSync;
  private readonly updateStepStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {
    this.selectByDepartmentStatement = database.prepare(
      `SELECT ${WORKFLOW_COLUMNS} FROM workflows WHERE department_id = ?
       ORDER BY is_default DESC, rowid`,
    );
    this.selectByIdStatement = database.prepare(
      `SELECT ${WORKFLOW_COLUMNS} FROM workflows WHERE id = ?`,
    );
    this.selectStepsStatement = database.prepare(
      `SELECT ${STEP_COLUMNS} FROM workflow_steps WHERE workflow_id = ? ORDER BY position`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO workflows (${WORKFLOW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStatement = database.prepare(
      `UPDATE workflows SET name = ?, description = ?, is_default = ?, enforce = ?, rules_json = ?
       WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM workflows WHERE id = ?');
    // Neutral values first, so removing a step never trips the return_to_step CHECK through
    // ON DELETE SET NULL of fail_target_step_id.
    this.parkStepsStatement = database.prepare(
      `UPDATE workflow_steps
       SET position = position + ${PARKED_POSITION_OFFSET}, on_fail = 'stop',
           fail_target_step_id = NULL, max_retries = 0
       WHERE workflow_id = ?`,
    );
    this.deleteStepStatement = database.prepare('DELETE FROM workflow_steps WHERE id = ?');
    this.insertStepStatement = database.prepare(
      `INSERT INTO workflow_steps
         (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id,
          max_retries, required_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStepStatement = database.prepare(
      `UPDATE workflow_steps
       SET position = ?, name = ?, owner_role = ?, gate = ?, on_fail = ?, fail_target_step_id = ?,
           max_retries = ?, required_output = ?
       WHERE id = ? AND workflow_id = ?`,
    );
  }

  listWorkflowsByDepartment(departmentId: string): Workflow[] {
    const rows = this.selectByDepartmentStatement.all(departmentId) as unknown as WorkflowRow[];
    return rows.map((row) => this.restoreWorkflow(row));
  }

  findWorkflowById(workflowId: string): Workflow | undefined {
    const row = this.selectByIdStatement.get(workflowId) as WorkflowRow | undefined;
    return row === undefined ? undefined : this.restoreWorkflow(row);
  }

  insertWorkflow(workflow: Workflow): void {
    const state = workflow.toState();
    this.transactionRunner.runInTransaction(() => {
      this.insertStatement.run(
        state.id,
        state.departmentId,
        state.name,
        state.description,
        Number(state.isDefault),
        Number(state.enforce),
        JSON.stringify(state.rules),
      );
      // Return targets always point to earlier steps, so inserting in order satisfies the FK.
      state.steps.forEach((step, position) => this.insertStep(state.id, position, step));
    });
  }

  updateWorkflow(workflow: Workflow): void {
    const state = workflow.toState();
    this.transactionRunner.runInTransaction(() => {
      this.updateStatement.run(
        state.name,
        state.description,
        Number(state.isDefault),
        Number(state.enforce),
        JSON.stringify(state.rules),
        state.id,
      );
      const storedIds = new Set(
        (this.selectStepsStatement.all(state.id) as unknown as WorkflowStepRow[]).map(
          (row) => row.id,
        ),
      );
      this.parkStepsStatement.run(state.id);
      const keptIds = new Set(state.steps.map((step) => step.id));
      for (const storedId of storedIds) {
        if (!keptIds.has(storedId)) this.deleteStepStatement.run(storedId);
      }
      state.steps.forEach((step, position) => {
        if (storedIds.has(step.id)) {
          this.updateStepStatement.run(
            position,
            step.name,
            step.ownerRole,
            step.gate,
            step.onFail,
            step.returnToStepId,
            step.maxRetries,
            step.requiredOutput,
            step.id,
            state.id,
          );
        } else {
          this.insertStep(state.id, position, step);
        }
      });
    });
  }

  deleteWorkflow(workflowId: string): void {
    this.deleteStatement.run(workflowId);
  }

  private insertStep(workflowId: string, position: number, step: WorkflowStepState): void {
    this.insertStepStatement.run(
      step.id,
      workflowId,
      position,
      step.name,
      step.ownerRole,
      step.gate,
      step.onFail,
      step.returnToStepId,
      step.maxRetries,
      step.requiredOutput,
    );
  }

  private restoreWorkflow(row: WorkflowRow): Workflow {
    const stepRows = this.selectStepsStatement.all(row.id) as unknown as WorkflowStepRow[];
    return Workflow.restore({
      id: row.id,
      departmentId: row.department_id,
      name: row.name,
      description: row.description,
      isDefault: row.is_default === 1,
      enforce: row.enforce === 1,
      rules: parseStoredRules(row.rules_json),
      steps: stepRows.map((stepRow) => ({
        id: stepRow.id,
        name: stepRow.name,
        ownerRole: stepRow.owner_role,
        gate: stepRow.gate,
        onFail: stepRow.on_fail,
        returnToStepId: stepRow.fail_target_step_id,
        maxRetries: Number(stepRow.max_retries),
        requiredOutput: stepRow.required_output ?? '',
      })),
    });
  }
}

/** Unknown or missing keys fall back to the defaults (the column started as '[]'). */
function parseStoredRules(rulesJson: string): WorkflowRules {
  const parsed = workflowRulesSchema.partial().safeParse(JSON.parse(rulesJson));
  return { ...DEFAULT_WORKFLOW_RULES, ...(parsed.success ? parsed.data : {}) };
}
