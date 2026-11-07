import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { AgentProvider, AgentRole, StepGate, TaskStatus } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { AgentTileQuery, AgentTileRow } from '../../application/ports/agent-tile.query';

const TASK_COLUMNS = `t.id AS task_id, t.sequence_number, t.title, t.status, t.working_dir,
  s.name AS step_name, s.gate AS step_gate, s.position AS step_position,
  (SELECT COUNT(*) FROM workflow_steps ws WHERE ws.workflow_id = t.workflow_id) AS step_count`;

interface TaskColumnsRow {
  task_id: string | null;
  sequence_number: number | null;
  title: string | null;
  status: TaskStatus | null;
  working_dir: string | null;
  step_name: string | null;
  step_gate: StepGate | null;
  step_position: number | null;
  step_count: number | null;
}

interface TileRow extends TaskColumnsRow {
  agent_id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  available: number;
  department_id: string;
  last_kind: string | null;
  last_payload: string | null;
  last_at: string | null;
}

@Injectable()
export class SqliteAgentTileQuery implements AgentTileQuery {
  private readonly tilesStatement: StatementSync;
  private readonly taskStatement: StatementSync;
  private readonly delegatedStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.tilesStatement = database.prepare(
      `SELECT a.id AS agent_id, a.name, a.role, a.provider, (a.enabled AND d.enabled) AS available,
              p.department_id, ${TASK_COLUMNS},
              e.kind AS last_kind, e.payload_json AS last_payload, e.created_at AS last_at
       FROM agents a
       JOIN positions p ON p.agent_id = a.id
       JOIN departments d ON d.id = p.department_id
       LEFT JOIN tasks t ON t.id = (
         -- The most pressing open task; with none open, the latest finished one (to review it).
         SELECT id FROM tasks
         WHERE assignee_agent_id = a.id
         ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'cancelling' THEN 1
                  WHEN 'waiting_approval' THEN 2 WHEN 'paused' THEN 3 WHEN 'queued' THEN 4
                  WHEN 'waiting_children' THEN 5 ELSE 6 END,
                  CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 0 ELSE priority END,
                  CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 0
                       ELSE sequence_number END,
                  updated_at DESC
         LIMIT 1)
       LEFT JOIN workflow_steps s ON s.id = t.current_step_id
       LEFT JOIN task_events e ON e.id = (
         SELECT MAX(id) FROM task_events
         WHERE agent_id = a.id AND kind NOT IN ('usage', 'session_started'))
       WHERE (:departmentId IS NULL OR p.department_id = :departmentId)
       ORDER BY p.rowid`,
    );
    this.taskStatement = database.prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks t
       LEFT JOIN workflow_steps s ON s.id = t.current_step_id WHERE t.id = ?`,
    );
    this.delegatedStatement = database.prepare(
      `SELECT task_id FROM task_delegations WHERE from_agent_id = ?
       GROUP BY task_id ORDER BY MAX(created_at) DESC LIMIT 50`,
    );
  }

  listAgentTileRows(departmentId: string | undefined): AgentTileRow[] {
    const rows = this.tilesStatement.all({
      departmentId: departmentId ?? null,
    }) as unknown as TileRow[];
    return rows.map((row) => ({
      agentId: row.agent_id,
      name: row.name,
      role: row.role,
      provider: row.provider,
      available: row.available === 1,
      departmentId: row.department_id,
      task: toTaskColumns(row),
      lastEvent:
        row.last_kind === null || row.last_at === null
          ? null
          : {
              kind: row.last_kind,
              payload: JSON.parse(row.last_payload ?? '{}') as Record<string, unknown>,
              createdAt: row.last_at,
            },
    }));
  }

  findTaskRow(taskId: string): AgentTileRow['task'] {
    const row = this.taskStatement.get(taskId) as TaskColumnsRow | undefined;
    return row === undefined ? null : toTaskColumns(row);
  }

  listDelegatedTaskIds(agentId: string): string[] {
    return (this.delegatedStatement.all(agentId) as unknown as Array<{ task_id: string }>).map(
      (row) => row.task_id,
    );
  }
}

function toTaskColumns(row: TaskColumnsRow): AgentTileRow['task'] {
  if (row.task_id === null || row.title === null || row.status === null) return null;
  return {
    id: row.task_id,
    sequenceNumber: Number(row.sequence_number ?? 0),
    title: row.title,
    status: row.status,
    workingDirectory: row.working_dir,
    stepName: row.step_name,
    stepGate: row.step_gate,
    stepPosition: row.step_position === null ? null : Number(row.step_position),
    stepCount: Number(row.step_count ?? 0),
  };
}
