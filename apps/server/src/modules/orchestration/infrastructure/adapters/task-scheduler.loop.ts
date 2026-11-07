import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import { TASK_SCHEDULER_ENABLED } from '../../../../shared/runtime/agent-engine-override';
import { ScheduleTasksUseCase } from '../../application/use-cases/schedule-tasks.use-case';

export const SCHEDULER_INTERVAL_MS = 1_000;

/**
 * Ticks the scheduler. Started by the startup recovery once orphaned CLI processes are dealt
 * with, so a new agent process can never be mistaken for an orphan.
 */
@Injectable()
export class TaskSchedulerLoop implements OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly scheduleTasksUseCase: ScheduleTasksUseCase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    @Inject(TASK_SCHEDULER_ENABLED) private readonly schedulingEnabled: boolean,
  ) {}

  startTaskScheduling(): void {
    if (this.timer !== undefined || !this.schedulingEnabled) return;
    this.timer = setInterval(() => void this.runSchedulingPass(), SCHEDULER_INTERVAL_MS);
    this.timer.unref();
    void this.runSchedulingPass();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Never rejects: a broken pass is logged and the next tick tries again. */
  private async runSchedulingPass(): Promise<void> {
    try {
      await this.scheduleTasksUseCase.scheduleQueuedTasks();
    } catch (error) {
      this.logger.error({ err: error }, 'task scheduling pass failed');
    }
  }
}
