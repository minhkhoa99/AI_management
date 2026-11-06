import type { AgentDetail, AgentSummary } from '@aiteam/contracts';

export const AGENT_DIRECTORY_QUERY = Symbol('AGENT_DIRECTORY_QUERY');

export interface AgentDirectoryFilter {
  departmentId?: string;
}

/** Read model joining agents with their seat and department, shaped for the API. */
export interface AgentDirectoryQuery {
  listAgentSummaries(filter: AgentDirectoryFilter): AgentSummary[];
  findAgentDetail(agentId: string): AgentDetail | undefined;
}
