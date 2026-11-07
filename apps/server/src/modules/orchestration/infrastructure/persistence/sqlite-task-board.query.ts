import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import {
  resolveTaskBoardColumn,
  type AgentProvider,
  type AgentRole,
  type StepGate,
  type TaskAgent,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { TaskBoardFilter, TaskBoardQuery } from '../../application/ports/task-board.query';
import { formatTaskCode } from '../../domain/entities/task';

interface TaskSummaryRow {
  id: string;
  sequence_number: number;
  department_id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  working_dir: string | null;
  created_at: string;
  updated_at: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_role: AgentRole | null;
  assignee_provider: AgentProvider | null;
  assignee_available: number | null;
  workflow_id: string | null;
  workflow_name: string | null;
  step_id: string | null;
  step_name: string | null;
  step_gate: StepGate | null;
  attachment_count: number;
}

interface TaskAgentRow {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  available: number;
}

const TASK_SUMMARY_SELECT = `
  SELECT t.id, t.sequence_number, t.department_id, t.title, t.priority, t.status, t.working_dir,
         t.created_at, t.updated_at,
         a.id AS assignee_id, a.name AS assignee_name, a.role AS assignee_role,
         a.provider AS assignee_provider, (a.enabled AND d.enabled) AS assignee_available,
         w.id AS workflow_id, w.name AS workflow_name,
         s.id AS step_id, s.name AS step_name, s.gate AS step_gate,
         (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id) AS attachment_count
  FROM tasks t
  JOIN departments d ON d.id = t.department_id
  LEFT JOIN agents a ON a.id = t.assignee_agent_id
  LEFT JOIN workflows w ON w.id = t.workflow_id
  LEFT JOIN workflow_steps s ON s.id = t.current_step_id`;

@Injectable()
export class SqliteTaskBoardQuery implements TaskBoardQuery {
  private readonly listStatement: StatementSync;
  private readonly findStatement: StatementSync;
  private readonly chainStatement: StatementSync;
  private readonly recentDirectoriesStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.listStatement = database.prepare(
      `${TASK_SUMMARY_SELECT}
       WHERE (:departmentId IS NULL OR t.department_id = :departmentId)
         AND (:workflowId IS NULL OR t.workflow_id = :workflowId)
       ORDER BY t.priority, t.sequence_number DESC`,
    );
    this.findStatement = database.prepare(`${TASK_SUMMARY_SELECT} WHERE t.id = ?`);
    // Walks the reporting line upwards (bounded), then lists it from the head down.
    this.chainStatement = database.prepare(
      `WITH RECURSIVE chain(position_id, reports_to, depth) AS (
         SELECT id, reports_to_position_id, 0 FROM positions WHERE agent_id = ?
         UNION ALL
         SELECT p.id, p.reports_to_position_id, chain.depth + 1
         FROM positions p JOIN chain ON p.id = chain.reports_to
         WHERE chain.depth < 50
       )
       SELECT a.id, a.name, a.role, a.provider, (a.enabled AND d.enabled) AS available
       FROM chain
       JOIN positions p ON p.id = chain.position_id
       JOIN agents a ON a.id = p.agent_id
       JOIN departments d ON d.id = p.department_id
       ORDER BY chain.depth DESC`,
    );
    this.recentDirectoriesStatement = database.prepare(
      `SELECT working_dir FROM tasks WHERE working_dir IS NOT NULL
       GROUP BY working_dir ORDER BY MAX(created_at) DESC LIMIT ?`,
    );
  }

  listTaskSummaries(filter: TaskBoardFilter): TaskSummary[] {
    const rows = this.listStatement.all({
      departmentId: filter.departmentId ?? null,
      workflowId: filter.workflowId ?? null,
    }) as unknown as TaskSummaryRow[];
    return rows.map(toTaskSummary);
  }

  findTaskSummary(taskId: string): TaskSummary | undefined {
    const row = this.findStatement.get(taskId) as TaskSummaryRow | undefined;
    return row === undefined ? undefined : toTaskSummary(row);
  }

  listReportingChain(agentId: string): TaskAgent[] {
    return (this.chainStatement.all(agentId) as unknown as TaskAgentRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      provider: row.provider,
      available: row.available === 1,
    }));
  }

  listRecentWorkingDirectories(limit: number): string[] {
    return (
      this.recentDirectoriesStatement.all(limit) as unknown as Array<{ working_dir: string }>
    ).map((row) => row.working_dir);
  }
}

function toTaskSummary(row: TaskSummaryRow): TaskSummary {
  const currentStepGate = row.step_gate;
  return {
    id: row.id,
    code: formatTaskCode(Number(row.sequence_number)),
    departmentId: row.department_id,
    title: row.title,
    priority: Number(row.priority) as TaskPriority,
    status: row.status,
    boardColumn: resolveTaskBoardColumn(row.status, currentStepGate),
    assignee:
      row.assignee_id === null ||
      row.assignee_name === null ||
      row.assignee_role === null ||
      row.assignee_provider === null
        ? null
        : {
            id: row.assignee_id,
            name: row.assignee_name,
            role: row.assignee_role,
            provider: row.assignee_provider,
            available: row.assignee_available === 1,
          },
    workflow:
      row.workflow_id === null || row.workflow_name === null
        ? null
        : { id: row.workflow_id, name: row.workflow_name },
    currentStep:
      row.step_id === null || row.step_name === null || currentStepGate === null
        ? null
        : { id: row.step_id, name: row.step_name, gate: currentStepGate },
    workingDirectory: row.working_dir,
    attachmentCount: Number(row.attachment_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
