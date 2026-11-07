import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { TaskPriority, TaskStatus } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { Task } from '../../domain/entities/task';
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
}

const TASK_COLUMNS = `id, sequence_number, department_id, workflow_id, title, description, criteria,
  priority, assignee_agent_id, current_step_id, status, working_dir, session_ref, test_command`;

@Injectable()
export class SqliteTaskRepository implements TaskRepository {
  private readonly selectByIdStatement: StatementSync;
  private readonly nextSequenceStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectByIdStatement = database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`);
    this.nextSequenceStatement = database.prepare(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_number FROM tasks',
    );
    this.insertStatement = database.prepare(
      `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStatement = database.prepare(
      `UPDATE tasks SET workflow_id = ?, title = ?, description = ?, criteria = ?, priority = ?,
         assignee_agent_id = ?, current_step_id = ?, status = ?, working_dir = ?, session_ref = ?,
         test_command = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM tasks WHERE id = ?');
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
    );
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
      state.id,
    );
  }

  deleteTask(taskId: string): void {
    this.deleteStatement.run(taskId);
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
  });
}
