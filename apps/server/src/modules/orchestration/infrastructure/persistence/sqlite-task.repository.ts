import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { FINISHED_TASK_STATUSES, type TaskPriority, type TaskStatus } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';
import { type EngineSnapshot, Task } from '../../domain/entities/task';
import type { TaskRepository } from '../../domain/repositories/task.repository';

interface TaskRow {
  id: string;
  sequence_number: number;
  department_id: string;
  workflow_id: string | null;
  title: string;
  description: string;
  criteria: string;
  priority: TaskPriority;
  assignee_agent_id: string | null;
  current_step_id: string | null;
  status: TaskStatus;
  working_dir: string | null;
  session_ref: string | null;
  test_command: string | null;
  preview_command: string | null;
  engine_snapshot_json: string | null;
  step_attempt: number;
  engine_failures: number;
  run_after: string | null;
  worktree_path: string | null;
  pending_feedback: string | null;
  status_note: string | null;
  base_sha: string | null;
  parent_task_id: string | null;
  review_pending: number;
}

const TASK_COLUMNS = `id, sequence_number, department_id, workflow_id, title, description, criteria,
  priority, assignee_agent_id, current_step_id, status, working_dir, session_ref, test_command,
  engine_snapshot_json, step_attempt, engine_failures, run_after, worktree_path, pending_feedback,
  status_note, base_sha, preview_command, review_pending, parent_task_id`;

@Injectable()
export class SqliteTaskRepository implements TaskRepository {
  private readonly selectByIdStatement: StatementSync;
  private readonly nextSequenceStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly runnableStatement: StatementSync;
  private readonly subtasksStatement: StatementSync;
  private readonly readyParentsStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    private readonly liveUpdateHub: LiveUpdateHub,
  ) {
    this.selectByIdStatement = database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`);
    this.nextSequenceStatement = database.prepare(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_number FROM tasks',
    );
    this.insertStatement = database.prepare(
      `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (${Array.from({ length: 25 }, () => '?').join(', ')})`,
    );
    this.updateStatement = database.prepare(
      `UPDATE tasks SET workflow_id = ?, title = ?, description = ?, criteria = ?, priority = ?,
         assignee_agent_id = ?, current_step_id = ?, status = ?, working_dir = ?, session_ref = ?,
         test_command = ?, engine_snapshot_json = ?, step_attempt = ?, engine_failures = ?,
         run_after = ?, worktree_path = ?, pending_feedback = ?, status_note = ?, base_sha = ?, preview_command = ?, review_pending = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM tasks WHERE id = ?');
    this.runnableStatement = database.prepare(
      `SELECT t.id FROM tasks t JOIN departments d ON d.id = t.department_id
       WHERE t.status = 'queued' AND d.enabled = 1 AND (t.run_after IS NULL OR t.run_after <= ?)
       ORDER BY t.priority, t.sequence_number`,
    );
    this.subtasksStatement = database.prepare(
      'SELECT id FROM tasks WHERE parent_task_id = ? ORDER BY sequence_number',
    );
    this.readyParentsStatement = database.prepare(
      `SELECT p.id FROM tasks p
        WHERE p.status = 'waiting_children'
          AND NOT EXISTS (
            SELECT 1 FROM tasks c
             WHERE c.parent_task_id = p.id
               AND c.status NOT IN (${FINISHED_TASK_STATUSES.map((status) => `'${status}'`).join(', ')}))
        ORDER BY p.sequence_number`,
    );
  }

  findTaskById(taskId: string): Task | undefined {
    const row = this.selectByIdStatement.get(taskId) as TaskRow | undefined;
    return row === undefined ? undefined : restoreTask(row);
  }

  allocateSequenceNumber(): number {
    return Number((this.nextSequenceStatement.get() as { next_number: number }).next_number);
  }

  insertTask(task: Task): void {
    const state = task.toState();
    this.insertStatement.run(
      state.id,
      state.sequenceNumber,
      state.departmentId,
      state.workflowId,
      state.title,
      state.description,
      state.criteria,
      state.priority,
      state.assigneeAgentId,
      state.currentStepId,
      state.status,
      state.workingDirectory,
      state.sessionRef,
      state.testCommand,
      ...executionColumns(state),
      state.parentTaskId,
    );
    this.announceTaskChange(state.id, state.departmentId, state.assigneeAgentId);
  }

  updateTask(task: Task): void {
    const state = task.toState();
    this.updateStatement.run(
      state.workflowId,
      state.title,
      state.description,
      state.criteria,
      state.priority,
      state.assigneeAgentId,
      state.currentStepId,
      state.status,
      state.workingDirectory,
      state.sessionRef,
      state.testCommand,
      ...executionColumns(state),
      state.id,
    );
    this.announceTaskChange(state.id, state.departmentId, state.assigneeAgentId);
  }

  deleteTask(taskId: string): void {
    const departmentId = this.findTaskById(taskId)?.departmentId ?? null;
    this.deleteStatement.run(taskId);
    this.announceTaskChange(taskId, departmentId, null);
  }

  /** Screens showing the task (board, detail, monitor) refresh on this. */
  private announceTaskChange(
    taskId: string,
    departmentId: string | null,
    agentId: string | null,
  ): void {
    this.liveUpdateHub.publishLiveUpdate({
      type: 'task.changed',
      taskId,
      departmentId,
      agentId,
      event: null,
    });
  }

  listRunnableTaskIds(nowIso: string): string[] {
    return (this.runnableStatement.all(nowIso) as unknown as Array<{ id: string }>).map(
      (row) => row.id,
    );
  }

  listSubtaskIds(parentTaskId: string): string[] {
    return (this.subtasksStatement.all(parentTaskId) as unknown as Array<{ id: string }>).map(
      (row) => row.id,
    );
  }

  listParentIdsReadyToResume(): string[] {
    return (this.readyParentsStatement.all() as unknown as Array<{ id: string }>).map(
      (row) => row.id,
    );
  }
}

function restoreTask(row: TaskRow): Task {
  return Task.restore({
    id: row.id,
    sequenceNumber: Number(row.sequence_number),
    departmentId: row.department_id,
    workflowId: row.workflow_id,
    title: row.title,
    description: row.description,
    criteria: row.criteria,
    priority: Number(row.priority) as TaskPriority,
    assigneeAgentId: row.assignee_agent_id,
    currentStepId: row.current_step_id,
    status: row.status,
    workingDirectory: row.working_dir,
    sessionRef: row.session_ref,
    testCommand: row.test_command,
    engineSnapshot:
      row.engine_snapshot_json === null
        ? null
        : (JSON.parse(row.engine_snapshot_json) as EngineSnapshot),
    stepAttempt: Number(row.step_attempt),
    engineFailures: Number(row.engine_failures),
    runAfter: row.run_after,
    worktreePath: row.worktree_path,
    pendingFeedback: row.pending_feedback,
    statusNote: row.status_note,
    baseSha: row.base_sha,
    previewCommand: row.preview_command,
    parentTaskId: row.parent_task_id,
    reviewPending: Number(row.review_pending) === 1,
  });
}

function executionColumns(state: ReturnType<Task['toState']>) {
  return [
    state.engineSnapshot === null ? null : JSON.stringify(state.engineSnapshot),
    state.stepAttempt,
    state.engineFailures,
    state.runAfter,
    state.worktreePath,
    state.pendingFeedback,
    state.statusNote,
    state.baseSha,
    state.previewCommand,
    state.reviewPending ? 1 : 0,
  ] as const;
}
