import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InProcessDomainEventBus } from '../../../../shared/events/in-process-domain-event-bus';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  AGENT_CONFIGURATION_CHANGED,
  type AgentConfigurationChanged,
} from '../../../agents/domain/events/agent-configuration-changed.event';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
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
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.domainEventBus.subscribeToDomainEvent<AgentConfigurationChanged>(
      AGENT_CONFIGURATION_CHANGED,
      (event) => {
        if (event.reducesPermissions) this.stopTurnsOf(event.agentId);
        if (changesEngine(event)) this.runWaitingTasksAtOnce(event.agentId);
      },
    );
  }

  private stopTurnsOf(agentId: string): void {
    for (const taskId of this.runRegistry.listTaskIdsRunBy(agentId)) {
      this.logger.info({ taskId, agentId }, 'stopping turn: permissions reduced');
      this.runRegistry.requestStop(taskId, 'reconfigure');
    }
  }

  /**
   * A new provider, connection or model may have quota left: tasks of the agent that wait for a
   * reset or a back-off run now, and so do queued reviews (their reviewer is not stored; a review
   * that still hits the quota simply waits again).
   */
  private runWaitingTasksAtOnce(agentId: string): void {
    try {
      this.clearWaitsOfQueuedTasks(agentId);
    } catch (error) {
      this.logger.warn({ agentId, err: error }, 'could not wake waiting tasks after engine change');
    }
  }

  private clearWaitsOfQueuedTasks(agentId: string): void {
    const taskIds = new Set([
      ...this.taskRepository.listQueuedTaskIdsAssignedTo(agentId),
      ...this.taskRepository.listQueuedTaskIdsWaitingForReview(),
    ]);
    for (const taskId of taskIds) {
      const task = this.taskRepository.findTaskById(taskId);
      if (task?.status !== 'queued') continue;
      task.clearRunAfter();
      this.taskRepository.updateTask(task);
      this.logger.info({ taskId, agentId }, 'engine changed: waiting task runs at once');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}

const ENGINE_FIELDS: ReadonlySet<string> = new Set(['provider', 'connectionId', 'model']);

function changesEngine(event: AgentConfigurationChanged): boolean {
  return event.changes.some((change) => ENGINE_FIELDS.has(change.field));
}
