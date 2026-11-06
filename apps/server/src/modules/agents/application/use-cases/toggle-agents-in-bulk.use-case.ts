import { Inject, Injectable } from '@nestjs/common';
import type { BulkSetAgentsEnabledRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../../shared/events/domain-event';
import type { AgentConfigurationChanged } from '../../domain/events/agent-configuration-changed.event';
import { AGENT_REPOSITORY, type AgentRepository } from '../../domain/repositories/agent.repository';

@Injectable()
export class ToggleAgentsInBulkUseCase {
  constructor(
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  /** All-or-nothing: if any id is unknown, nothing changes. */
  toggleAgentsInBulk(request: BulkSetAgentsEnabledRequest): { updatedCount: number } {
    const configurationChanges = this.transactionRunner.runInTransaction(() => {
      const agents = this.agentRepository.findAgentsByIds(request.agentIds);
      if (agents.length !== request.agentIds.length) {
        const foundIds = new Set(agents.map((agent) => agent.id));
        throw new NotFoundError('Một số agent không tồn tại.', {
          code: 'AGENT_NOT_FOUND',
          details: {
            missingAgentIds: request.agentIds.filter((agentId) => !foundIds.has(agentId)),
          },
        });
      }
      const events: AgentConfigurationChanged[] = [];
      for (const agent of agents) {
        const configurationChanged = agent.setEnabled(request.enabled);
        if (configurationChanged !== null) {
          this.agentRepository.updateAgent(agent);
          events.push(configurationChanged);
        }
      }
      return events;
    });
    for (const configurationChanged of configurationChanges) {
      this.domainEventPublisher.publishDomainEvent(configurationChanged);
    }
    // Agents already in the requested state count as updated: the request is fully satisfied.
    return { updatedCount: request.agentIds.length };
  }
}
