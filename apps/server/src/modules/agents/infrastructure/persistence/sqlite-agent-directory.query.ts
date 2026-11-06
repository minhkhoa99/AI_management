import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AccessLevel,
  AgentDetail,
  AgentProvider,
  AgentRole,
  AgentSummary,
} from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  AgentDirectoryFilter,
  AgentDirectoryQuery,
} from '../../application/ports/agent-directory.query';

interface AgentDirectoryRow {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  model: string | null;
  connection_id: string | null;
  access_level: AccessLevel;
  network_access: number;
  enabled: number;
  position_id: string;
  reports_to_position_id: string | null;
  department_id: string;
  department_name: string;
  department_color: string;
  department_enabled: number;
  reports_to_agent_name: string | null;
  subordinate_count: number;
}

const AGENT_DIRECTORY_SELECT = `
  SELECT a.id, a.name, a.role, a.provider, a.model, a.connection_id, a.access_level,
         a.network_access, a.enabled,
         p.id AS position_id, p.reports_to_position_id,
         d.id AS department_id, d.name AS department_name, d.color AS department_color,
         d.enabled AS department_enabled,
         manager_agent.name AS reports_to_agent_name,
         (SELECT COUNT(*) FROM positions sub WHERE sub.reports_to_position_id = p.id) AS subordinate_count
  FROM agents a
  JOIN positions p ON p.agent_id = a.id
  JOIN departments d ON d.id = p.department_id
  LEFT JOIN positions manager_position ON manager_position.id = p.reports_to_position_id
  LEFT JOIN agents manager_agent ON manager_agent.id = manager_position.agent_id`;

/** Agents are listed department by department (creation order), then in seat order. */
const AGENT_DIRECTORY_ORDER = 'ORDER BY d.created_at, d.rowid, p.rowid';

@Injectable()
export class SqliteAgentDirectoryQuery implements AgentDirectoryQuery {
  private readonly selectAllStatement: StatementSync;
  private readonly selectByDepartmentStatement: StatementSync;
  private readonly selectByAgentStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectAllStatement = database.prepare(
      `${AGENT_DIRECTORY_SELECT} ${AGENT_DIRECTORY_ORDER}`,
    );
    this.selectByDepartmentStatement = database.prepare(
      `${AGENT_DIRECTORY_SELECT} WHERE d.id = ? ${AGENT_DIRECTORY_ORDER}`,
    );
    this.selectByAgentStatement = database.prepare(`${AGENT_DIRECTORY_SELECT} WHERE a.id = ?`);
  }

  listAgentSummaries(filter: AgentDirectoryFilter): AgentSummary[] {
    const rows =
      filter.departmentId === undefined
        ? this.selectAllStatement.all()
        : this.selectByDepartmentStatement.all(filter.departmentId);
    return (rows as unknown as AgentDirectoryRow[]).map(toAgentSummary);
  }

  findAgentDetail(agentId: string): AgentDetail | undefined {
    const row = this.selectByAgentStatement.get(agentId) as AgentDirectoryRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      ...toAgentSummary(row),
      connectionId: row.connection_id,
      accessLevel: row.access_level,
      networkAccess: row.network_access === 1,
      reportsToAgentName: row.reports_to_agent_name,
      subordinateCount: Number(row.subordinate_count),
    };
  }
}

function toAgentSummary(row: AgentDirectoryRow): AgentSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    provider: row.provider,
    model: row.model,
    enabled: row.enabled === 1,
    positionId: row.position_id,
    reportsToPositionId: row.reports_to_position_id,
    department: {
      id: row.department_id,
      name: row.department_name,
      color: row.department_color,
      enabled: row.department_enabled === 1,
    },
  };
}
