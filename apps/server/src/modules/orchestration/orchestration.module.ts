import { Module } from '@nestjs/common';
import { RecoverInterruptedWorkUseCase } from './application/use-cases/recover-interrupted-work.use-case';
import { TASK_RECOVERY_REPOSITORY } from './domain/repositories/task-recovery.repository';
import { StartupRecoveryTrigger } from './infrastructure/adapters/startup-recovery.trigger';
import { SqliteTaskRecoveryRepository } from './infrastructure/persistence/sqlite-task-recovery.repository';

/**
 * Tasks, delegation, workflows, step gates, approvals and the task scheduler (phase 3).
 * Already here: startup recovery after an abrupt stop (error policy).
 */
@Module({
  providers: [
    { provide: TASK_RECOVERY_REPOSITORY, useClass: SqliteTaskRecoveryRepository },
    RecoverInterruptedWorkUseCase,
    StartupRecoveryTrigger,
  ],
})
export class OrchestrationModule {}
