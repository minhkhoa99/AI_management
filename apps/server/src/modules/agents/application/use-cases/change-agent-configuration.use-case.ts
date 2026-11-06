import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail, ChangeAgentConfigurationRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../../shared/events/domain-event';
import { AGENT_REPOSITORY, type AgentRepository } from '../../domain/repositories/agent.repository';
import {
  PROVIDER_CONNECTION_LOOKUP,
  type ProviderConnectionLookup,
} from '../ports/provider-connection-lookup.port';
import { createAgentNotFoundError } from './agent-not-found.error';
import { GetAgentDetailUseCase } from './get-agent-detail.use-case';

/** Changes an agent's brain and/or permissions and publishes AgentConfigurationChanged. */
@Injectable()
export class ChangeAgentConfigurationUseCase {
  constructor(
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(PROVIDER_CONNECTION_LOOKUP)
    private readonly providerConnectionLookup: ProviderConnectionLookup,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly domainEventPublisher: DomainEventPublisher,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  changeAgentConfiguration(agentId: string, request: ChangeAgentConfigurationRequest): AgentDetail {
    const configurationChanged = this.transactionRunner.runInTransaction(() => {
      const agent = this.agentRepository.findAgentById(agentId);
      if (agent === undefined) {
        throw createAgentNotFoundError();
      }
      const event = agent.reconfigure(request);
      const connectionId = agent.readEngineConfiguration().connectionId;
      if (connectionId !== null && !this.providerConnectionLookup.connectionExists(connectionId)) {
        throw new NotFoundError('Không tìm thấy kết nối API đã chọn.', {
          code: 'CONNECTION_NOT_FOUND',
        });
      }
      if (event !== null) {
        this.agentRepository.updateAgent(agent);
      }
      return event;
    });
    // Published only after commit, so subscribers never see a change that was rolled back.
    if (configurationChanged !== null) {
      this.domainEventPublisher.publishDomainEvent(configurationChanged);
    }
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
