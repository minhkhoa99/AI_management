import { Inject, Injectable } from '@nestjs/common';
import type { BulkSetAgentsEnabledRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { AGENT_REPOSITORY, type AgentRepository } from '../../domain/repositories/agent.repository';

@Injectable()
export class ToggleAgentsInBulkUseCase {
  constructor(
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {}

  /** All-or-nothing: if any id is unknown, nothing changes. */
  toggleAgentsInBulk(request: BulkSetAgentsEnabledRequest): { updatedCount: number } {
    return this.transactionRunner.runInTransaction(() => {
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
      for (const agent of agents) {
        agent.setEnabled(request.enabled);
        this.agentRepository.updateAgent(agent);
      }
      return { updatedCount: agents.length };
    });
  }
}
