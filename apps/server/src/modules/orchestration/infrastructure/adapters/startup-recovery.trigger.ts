import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import { RecoverInterruptedWorkUseCase } from '../../application/use-cases/recover-interrupted-work.use-case';
import { TaskSchedulerLoop } from './task-scheduler.loop';

/**
 * Runs recovery during application init, i.e. before the HTTP server starts listening, then
 * starts the task scheduler.
 */
@Injectable()
export class StartupRecoveryTrigger implements OnApplicationBootstrap {
  constructor(
    private readonly recoverInterruptedWorkUseCase: RecoverInterruptedWorkUseCase,
    private readonly taskSchedulerLoop: TaskSchedulerLoop,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const report = await this.recoverInterruptedWorkUseCase.recoverInterruptedWork();
    const somethingRecovered = Object.values(report).some((count) => count > 0);
    this.logger[somethingRecovered ? 'warn' : 'info'](report, 'startup recovery finished');
    this.taskSchedulerLoop.startTaskScheduling();
  }
}
