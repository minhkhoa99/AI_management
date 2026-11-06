import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail } from '@aiteam/contracts';
import { AGENT_REPOSITORY, type AgentRepository } from '../../domain/repositories/agent.repository';
import { createAgentNotFoundError } from './agent-not-found.error';
import { GetAgentDetailUseCase } from './get-agent-detail.use-case';

@Injectable()
export class ToggleAgentUseCase {
  constructor(
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  toggleAgent(agentId: string, enabled: boolean): AgentDetail {
    const agent = this.agentRepository.findAgentById(agentId);
    if (agent === undefined) {
      throw createAgentNotFoundError();
    }
    agent.setEnabled(enabled);
    this.agentRepository.updateAgent(agent);
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
