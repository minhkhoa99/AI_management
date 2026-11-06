import { Inject, Injectable } from '@nestjs/common';
import type { AgentSummary } from '@aiteam/contracts';
import { AGENT_DIRECTORY_QUERY, type AgentDirectoryQuery } from '../ports/agent-directory.query';

export interface AgentListFilter {
  departmentId?: string;
  /** Case-insensitive (Vietnamese rules) match on name or role. */
  searchText?: string;
}

@Injectable()
export class ListAgentsUseCase {
  constructor(
    @Inject(AGENT_DIRECTORY_QUERY) private readonly agentDirectory: AgentDirectoryQuery,
  ) {}

  listAgents(filter: AgentListFilter): AgentSummary[] {
    const agents = this.agentDirectory.listAgentSummaries({ departmentId: filter.departmentId });
    const searchKey = normaliseSearchText(filter.searchText ?? '');
    if (searchKey.length === 0) {
      return agents;
    }
    return agents.filter(
      (agent) =>
        normaliseSearchText(agent.name).includes(searchKey) ||
        normaliseSearchText(agent.role).includes(searchKey),
    );
  }
}

function normaliseSearchText(text: string): string {
  return text.normalize('NFC').trim().toLocaleLowerCase('vi');
}
