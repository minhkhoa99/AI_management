import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InProcessDomainEventBus } from '../../../../shared/events/in-process-domain-event-bus';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  AGENT_CONFIGURATION_CHANGED,
  type AgentConfigurationChanged,
} from '../../domain/events/agent-configuration-changed.event';

/** Writes every agent configuration change to the structured log (audit trail). */
@Injectable()
export class AgentConfigurationAuditSubscriber implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly domainEventBus: InProcessDomainEventBus,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.domainEventBus.subscribeToDomainEvent<AgentConfigurationChanged>(
      AGENT_CONFIGURATION_CHANGED,
      (event) => {
        this.logger.info(
          {
            agentId: event.agentId,
            changes: event.changes,
            reducesPermissions: event.reducesPermissions,
          },
          'agent configuration changed',
        );
      },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
