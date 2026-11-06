import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { AccessLevel, AgentProvider, AgentRole } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { Agent } from '../../domain/entities/agent';
import type { AgentRepository } from '../../domain/repositories/agent.repository';

interface AgentRow {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  connection_id: string | null;
  model: string | null;
  access_level: AccessLevel;
  network_access: number;
  enabled: number;
}

const AGENT_COLUMNS =
  'id, name, role, provider, connection_id, model, access_level, network_access, enabled';

@Injectable()
export class SqliteAgentRepository implements AgentRepository {
  private readonly selectByIdStatement: StatementSync;
  private readonly selectByIdsStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectByIdStatement = database.prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE id = ?`);
    // json_each keeps the statement fully parameterised whatever the number of ids.
    this.selectByIdsStatement = database.prepare(
      `SELECT ${AGENT_COLUMNS} FROM agents WHERE id IN (SELECT value FROM json_each(?))`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO agents (${AGENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStatement = database.prepare(
      `UPDATE agents SET name = ?, role = ?, provider = ?, connection_id = ?, model = ?,
         access_level = ?, network_access = ?, enabled = ? WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM agents WHERE id = ?');
  }

  findAgentById(agentId: string): Agent | undefined {
    const row = this.selectByIdStatement.get(agentId) as AgentRow | undefined;
    return row === undefined ? undefined : restoreAgent(row);
  }

  findAgentsByIds(agentIds: readonly string[]): Agent[] {
    if (agentIds.length === 0) {
      return [];
    }
    const rows = this.selectByIdsStatement.all(JSON.stringify(agentIds)) as unknown as AgentRow[];
    return rows.map(restoreAgent);
  }

  insertAgent(agent: Agent): void {
    const state = agent.toState();
    this.insertStatement.run(
      state.id,
      state.name,
      state.role,
      state.provider,
      state.connectionId,
      state.model,
      state.accessLevel,
      Number(state.networkAccess),
      Number(state.enabled),
    );
  }

  updateAgent(agent: Agent): void {
    const state = agent.toState();
    this.updateStatement.run(
      state.name,
      state.role,
      state.provider,
      state.connectionId,
      state.model,
      state.accessLevel,
      Number(state.networkAccess),
      Number(state.enabled),
      state.id,
    );
  }

  deleteAgent(agentId: string): void {
    this.deleteStatement.run(agentId);
  }
}

function restoreAgent(row: AgentRow): Agent {
  return Agent.restore({
    id: row.id,
    name: row.name,
    role: row.role,
    provider: row.provider,
    connectionId: row.connection_id,
    model: row.model,
    accessLevel: row.access_level,
    networkAccess: row.network_access === 1,
    enabled: row.enabled === 1,
  });
}
