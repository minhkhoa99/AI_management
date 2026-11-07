import { Module } from '@nestjs/common';
import { DepartmentsModule } from '../departments/departments.module';
import { AttachQaDocumentUseCase } from './application/use-cases/attach-qa-document.use-case';
import { CreateTaskUseCase } from './application/use-cases/create-task.use-case';
import { DeleteTaskUseCase } from './application/use-cases/delete-task.use-case';
import { GetTaskDetailUseCase } from './application/use-cases/get-task-detail.use-case';
import { GetWorkspaceSettingsUseCase } from './application/use-cases/get-workspace-settings.use-case';
import { ListRecentDirectoriesUseCase } from './application/use-cases/list-recent-directories.use-case';
import { ListTasksUseCase } from './application/use-cases/list-tasks.use-case';
import { PickLocalDirectoryUseCase } from './application/use-cases/pick-local-directory.use-case';
import { RemoveQaDocumentUseCase } from './application/use-cases/remove-qa-document.use-case';
import { TaskPlacementPolicy } from './application/use-cases/task-placement-policy';
import { UpdateTaskUseCase } from './application/use-cases/update-task.use-case';
import { UpdateWorkspaceSettingsUseCase } from './application/use-cases/update-workspace-settings.use-case';
import { ValidateWorkingDirectoryUseCase } from './application/use-cases/validate-working-directory.use-case';
import { WorkingDirectoryPolicy } from './application/use-cases/working-directory-policy';
import { DIRECTORY_INSPECTOR } from './application/ports/local-directories.port';
import { QA_DOCUMENT_STORE } from './application/ports/qa-document-store.port';
import { TASK_BOARD_QUERY } from './application/ports/task-board.query';
import { TASK_ATTACHMENT_REPOSITORY } from './domain/repositories/task-attachment.repository';
import { TASK_REPOSITORY } from './domain/repositories/task.repository';
import { WORKSPACE_SETTINGS_REPOSITORY } from './domain/repositories/workspace-settings.repository';
import { FileQaDocumentStore } from './infrastructure/adapters/file-qa-document-store';
import { FsDirectoryInspector } from './infrastructure/adapters/fs-directory-inspector';
import { SqliteTaskAttachmentRepository } from './infrastructure/persistence/sqlite-task-attachment.repository';
import { SqliteTaskBoardQuery } from './infrastructure/persistence/sqlite-task-board.query';
import { SqliteTaskRepository } from './infrastructure/persistence/sqlite-task.repository';
import { SqliteWorkspaceSettingsRepository } from './infrastructure/persistence/sqlite-workspace-settings.repository';
import { TasksController } from './presentation/controllers/tasks.controller';
import { WorkspaceController } from './presentation/controllers/workspace.controller';
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
  controllers: [WorkflowsController, TasksController, WorkspaceController],
  providers: [
    { provide: TASK_RECOVERY_REPOSITORY, useClass: SqliteTaskRecoveryRepository },
    { provide: WORKFLOW_REPOSITORY, useClass: SqliteWorkflowRepository },
    { provide: WORKFLOW_TASK_USAGE, useClass: SqliteWorkflowTaskUsage },
    { provide: TASK_REPOSITORY, useClass: SqliteTaskRepository },
    { provide: TASK_ATTACHMENT_REPOSITORY, useClass: SqliteTaskAttachmentRepository },
    { provide: WORKSPACE_SETTINGS_REPOSITORY, useClass: SqliteWorkspaceSettingsRepository },
    { provide: TASK_BOARD_QUERY, useClass: SqliteTaskBoardQuery },
    { provide: DIRECTORY_INSPECTOR, useClass: FsDirectoryInspector },
    { provide: QA_DOCUMENT_STORE, useClass: FileQaDocumentStore },
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
    WorkingDirectoryPolicy,
    TaskPlacementPolicy,
    ListTasksUseCase,
    GetTaskDetailUseCase,
    CreateTaskUseCase,
    UpdateTaskUseCase,
    DeleteTaskUseCase,
    AttachQaDocumentUseCase,
    RemoveQaDocumentUseCase,
    GetWorkspaceSettingsUseCase,
    UpdateWorkspaceSettingsUseCase,
    PickLocalDirectoryUseCase,
    ValidateWorkingDirectoryUseCase,
    ListRecentDirectoriesUseCase,
  ],
})
export class OrchestrationModule {}
