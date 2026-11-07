import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { AccessLevel, AgentProvider, AgentRole, DelegationReason } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { StaffAgent, StaffDirectory } from '../../application/ports/task-execution.ports';
import type { EngineSnapshot } from '../../domain/entities/task';
import type { CheckpointRepository } from '../../domain/repositories/checkpoint.repository';
import type {
  TaskDelegationRecord,
  TaskDelegationRepository,
} from '../../domain/repositories/task-delegation.repository';

@Injectable()
export class SqliteTaskDelegationRepository implements TaskDelegationRepository {
  private readonly insertStatement: StatementSync;
  private readonly selectStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.insertStatement = database.prepare(
      'INSERT INTO task_delegations (id, task_id, from_agent_id, to_agent_id, reason) VALUES (?, ?, ?, ?, ?)',
    );
    this.selectStatement = database.prepare(
      `SELECT f.name AS from_name, t.name AS to_name, d.reason, d.created_at
       FROM task_delegations d
       LEFT JOIN agents f ON f.id = d.from_agent_id
       LEFT JOIN agents t ON t.id = d.to_agent_id
       WHERE d.task_id = ? ORDER BY d.created_at, d.rowid`,
    );
  }

  recordDelegation(input: {
    id: string;
    taskId: string;
    fromAgentId: string | null;
    toAgentId: string;
    reason: DelegationReason;
  }): void {
    this.insertStatement.run(
      input.id,
      input.taskId,
      input.fromAgentId,
      input.toAgentId,
      input.reason,
    );
  }

  listDelegations(taskId: string): TaskDelegationRecord[] {
    const rows = this.selectStatement.all(taskId) as unknown as Array<{
      from_name: string | null;
      to_name: string | null;
      reason: DelegationReason;
      created_at: string;
    }>;
    return rows.map((row) => ({
      fromAgentName: row.from_name,
      toAgentName: row.to_name,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }
}

@Injectable()
export class SqliteCheckpointRepository implements CheckpointRepository {
  private readonly insertStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.insertStatement = database.prepare(
      'INSERT INTO checkpoints (id, task_id, sha, message, files_json) VALUES (?, ?, ?, ?, ?)',
    );
  }

  insertCheckpoint(input: {
    id: string;
    taskId: string;
    sha: string;
    message: string;
    files: readonly string[];
  }): void {
    this.insertStatement.run(
      input.id,
      input.taskId,
      input.sha,
      input.message,
      JSON.stringify(input.files),
    );
  }
}

interface StaffRow {
  agent_id: string;
  name: string;
  role: AgentRole;
  available: number;
  position_id: string;
  reports_to_position_id: string | null;
}

interface EngineRow {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  connection_id: string | null;
  model: string | null;
  access_level: AccessLevel;
  network_access: number;
}

@Injectable()
export class SqliteStaffDirectory implements StaffDirectory {
  private readonly staffStatement: StatementSync;
  private readonly engineStatement: StatementSync;
  private readonly activeTasksStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.staffStatement = database.prepare(
      `SELECT a.id AS agent_id, a.name, a.role, (a.enabled AND d.enabled) AS available,
              p.id AS position_id, p.reports_to_position_id
       FROM positions p
       JOIN agents a ON a.id = p.agent_id
       JOIN departments d ON d.id = p.department_id
       WHERE p.department_id = ? ORDER BY p.rowid`,
    );
    this.engineStatement = database.prepare(
      `SELECT id, name, role, provider, connection_id, model, access_level, network_access
       FROM agents WHERE id = ?`,
    );
    this.activeTasksStatement = database.prepare(
      `SELECT assignee_agent_id, COUNT(*) AS task_count FROM tasks
       WHERE department_id = ? AND assignee_agent_id IS NOT NULL
         AND status IN ('running', 'waiting_approval', 'cancelling')
       GROUP BY assignee_agent_id`,
    );
  }

  listDepartmentStaff(departmentId: string): StaffAgent[] {
    return (this.staffStatement.all(departmentId) as unknown as StaffRow[]).map((row) => ({
      agentId: row.agent_id,
      name: row.name,
      role: row.role,
      available: row.available === 1,
      positionId: row.position_id,
      reportsToPositionId: row.reports_to_position_id,
    }));
  }

  readEngineSnapshot(
    agentId: string,
  ): (EngineSnapshot & { name: string; role: AgentRole }) | undefined {
    const row = this.engineStatement.get(agentId) as EngineRow | undefined;
    if (row === undefined) return undefined;
    return {
      agentId: row.id,
      name: row.name,
      role: row.role,
      provider: row.provider,
      connectionId: row.connection_id,
      model: row.model,
      accessLevel: row.access_level,
      networkAccess: row.network_access === 1,
    };
  }

  countActiveTasksByAgent(departmentId: string): Map<string, number> {
    const rows = this.activeTasksStatement.all(departmentId) as unknown as Array<{
      assignee_agent_id: string;
      task_count: number;
    }>;
    return new Map(rows.map((row) => [row.assignee_agent_id, Number(row.task_count)]));
  }
}
