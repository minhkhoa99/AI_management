import { Module } from '@nestjs/common';
import { DepartmentsModule } from '../departments/departments.module';
import { CreateWorkflowUseCase } from './application/use-cases/create-workflow.use-case';
import { DeleteWorkflowUseCase } from './application/use-cases/delete-workflow.use-case';
import { DuplicateWorkflowUseCase } from './application/use-cases/duplicate-workflow.use-case';
import { ListWorkflowTemplatesUseCase } from './application/use-cases/list-workflow-templates.use-case';
import { ListWorkflowsUseCase } from './application/use-cases/list-workflows.use-case';
import { RecoverInterruptedWorkUseCase } from './application/use-cases/recover-interrupted-work.use-case';
import { ReplaceWorkflowStepsUseCase } from './application/use-cases/replace-workflow-steps.use-case';
import { SetDefaultWorkflowUseCase } from './application/use-cases/set-default-workflow.use-case';
import { UpdateWorkflowRulesUseCase } from './application/use-cases/update-workflow-rules.use-case';
import { UpdateWorkflowUseCase } from './application/use-cases/update-workflow.use-case';
import { WorkflowPresenter } from './application/use-cases/workflow-presenter';
import { TASK_RECOVERY_REPOSITORY } from './domain/repositories/task-recovery.repository';
import { WORKFLOW_TASK_USAGE } from './domain/repositories/workflow-task-usage.repository';
import { WORKFLOW_REPOSITORY } from './domain/repositories/workflow.repository';
import { StartupRecoveryTrigger } from './infrastructure/adapters/startup-recovery.trigger';
import { SqliteTaskRecoveryRepository } from './infrastructure/persistence/sqlite-task-recovery.repository';
import { SqliteWorkflowTaskUsage } from './infrastructure/persistence/sqlite-workflow-task-usage';
import { SqliteWorkflowRepository } from './infrastructure/persistence/sqlite-workflow.repository';
import { WorkflowsController } from './presentation/controllers/workflows.controller';

/**
 * Tasks, delegation, workflows, step gates, approvals and the task scheduler (phase 3).
 * Also: startup recovery after an abrupt stop (error policy).
 */
@Module({
  imports: [DepartmentsModule],
  controllers: [WorkflowsController],
  providers: [
    { provide: TASK_RECOVERY_REPOSITORY, useClass: SqliteTaskRecoveryRepository },
    { provide: WORKFLOW_REPOSITORY, useClass: SqliteWorkflowRepository },
    { provide: WORKFLOW_TASK_USAGE, useClass: SqliteWorkflowTaskUsage },
    RecoverInterruptedWorkUseCase,
    StartupRecoveryTrigger,
    WorkflowPresenter,
    ListWorkflowsUseCase,
    ListWorkflowTemplatesUseCase,
    CreateWorkflowUseCase,
    UpdateWorkflowUseCase,
    DuplicateWorkflowUseCase,
    SetDefaultWorkflowUseCase,
    DeleteWorkflowUseCase,
    ReplaceWorkflowStepsUseCase,
    UpdateWorkflowRulesUseCase,
  ],
})
export class OrchestrationModule {}
