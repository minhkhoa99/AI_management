import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail } from '@aiteam/contracts';
import { AGENT_DIRECTORY_QUERY, type AgentDirectoryQuery } from '../ports/agent-directory.query';
import { createAgentNotFoundError } from './agent-not-found.error';

@Injectable()
export class GetAgentDetailUseCase {
  constructor(
    @Inject(AGENT_DIRECTORY_QUERY) private readonly agentDirectory: AgentDirectoryQuery,
  ) {}

  getAgentDetail(agentId: string): AgentDetail {
    const agentDetail = this.agentDirectory.findAgentDetail(agentId);
    if (agentDetail === undefined) {
      throw createAgentNotFoundError();
    }
    return agentDetail;
  }
}
