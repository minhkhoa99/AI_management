import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail } from '@aiteam/contracts';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../../shared/events/domain-event';
import { AGENT_REPOSITORY, type AgentRepository } from '../../domain/repositories/agent.repository';
import { createAgentNotFoundError } from './agent-not-found.error';
import { GetAgentDetailUseCase } from './get-agent-detail.use-case';

@Injectable()
export class ToggleAgentUseCase {
  constructor(
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly domainEventPublisher: DomainEventPublisher,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  toggleAgent(agentId: string, enabled: boolean): AgentDetail {
    const agent = this.agentRepository.findAgentById(agentId);
    if (agent === undefined) {
      throw createAgentNotFoundError();
    }
    const configurationChanged = agent.setEnabled(enabled);
    if (configurationChanged !== null) {
      this.agentRepository.updateAgent(agent);
      this.domainEventPublisher.publishDomainEvent(configurationChanged);
    }
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
