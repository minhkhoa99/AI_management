import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InProcessDomainEventBus } from '../../../../shared/events/in-process-domain-event-bus';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  AGENT_CONFIGURATION_CHANGED,
  type AgentConfigurationChanged,
} from '../../../agents/domain/events/agent-configuration-changed.event';
import { TaskRunRegistry } from '../../application/use-cases/task-run-registry';

/**
 * Plan §5.11. Running sessions keep the engine snapshot taken when they started. When the
 * change reduces permissions, the agent's current turn stops now (a checkpoint is saved) and the
 * step runs again with the new permissions. Engine or connection changes are handled when the
 * next turn starts (the old engine session is not resumed, the agent gets a handoff).
 */
@Injectable()
export class AgentReconfigurationSubscriber implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly domainEventBus: InProcessDomainEventBus,
    private readonly runRegistry: TaskRunRegistry,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.domainEventBus.subscribeToDomainEvent<AgentConfigurationChanged>(
      AGENT_CONFIGURATION_CHANGED,
      (event) => {
        if (!event.reducesPermissions) return;
        for (const taskId of this.runRegistry.listTaskIdsRunBy(event.agentId)) {
          this.logger.info(
            { taskId, agentId: event.agentId },
            'stopping turn: permissions reduced',
          );
          this.runRegistry.requestStop(taskId, 'reconfigure');
        }
      },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
