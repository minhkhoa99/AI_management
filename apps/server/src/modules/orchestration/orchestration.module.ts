import { Module } from '@nestjs/common';
import { DepartmentsModule } from '../departments/departments.module';
import { AGENT_TILE_QUERY } from './application/ports/agent-tile.query';
import { AddLineCommentUseCase } from './application/use-cases/add-line-comment.use-case';
import { BuildCheckpointDiffUseCase } from './application/use-cases/build-checkpoint-diff.use-case';
import { BuildTaskDiffUseCase } from './application/use-cases/build-task-diff.use-case';
import { ListAgentTilesUseCase } from './application/use-cases/list-agent-tiles.use-case';
import { ListCheckpointsUseCase } from './application/use-cases/list-checkpoints.use-case';
import { ListDelegatedTasksUseCase } from './application/use-cases/list-delegated-tasks.use-case';
import { ListLineCommentsUseCase } from './application/use-cases/list-line-comments.use-case';
import { ListWorkspaceTreeUseCase } from './application/use-cases/list-workspace-tree.use-case';
import { PauseTaskUseCase } from './application/use-cases/pause-task.use-case';
import { ReadWorkspaceFileUseCase } from './application/use-cases/read-workspace-file.use-case';
import { ResumeTaskUseCase } from './application/use-cases/resume-task.use-case';
import { RevertWorkspaceFileUseCase } from './application/use-cases/revert-workspace-file.use-case';
import { StartTaskPreviewUseCase } from './application/use-cases/start-task-preview.use-case';
import { StopTaskPreviewUseCase } from './application/use-cases/stop-task-preview.use-case';
import { TaskPreviewRegistry } from './application/use-cases/task-preview-registry';
import {
  LOCAL_PORT_PROBE,
  PREVIEW_PROCESS_LAUNCHER,
} from './application/ports/preview-server.ports';
import { NodeLocalPortProbe } from './infrastructure/adapters/node-local-port-probe';
import { ShellPreviewProcessLauncher } from './infrastructure/adapters/shell-preview-process-launcher';
import { PreviewController } from './presentation/controllers/preview.controller';
import { SubmitCodeReviewUseCase } from './application/use-cases/submit-code-review.use-case';
import { TaskWorkspaceAccess } from './application/use-cases/task-workspace-access';
import { SqliteAgentTileQuery } from './infrastructure/persistence/sqlite-agent-tile.query';
import { MonitorController } from './presentation/controllers/monitor.controller';
import { AgentsModule } from '../agents/agents.module';
import { ProvidersModule } from '../providers/providers.module';
import { TracingModule } from '../tracing/tracing.module';
import { ApprovalPresenter } from './application/use-cases/approval-presenter';
import { ApprovalRequests } from './application/use-cases/approval-requests';
import { AutoDelegateByWorkloadUseCase } from './application/use-cases/auto-delegate-task.use-case';
import { DecideApprovalUseCase } from './application/use-cases/decide-approval.use-case';
import { DelegateTaskToSubordinateUseCase } from './application/use-cases/delegate-task.use-case';
import { FinishTaskTurnUseCase } from './application/use-cases/finish-task-turn.use-case';
import { ListApprovalsUseCase } from './application/use-cases/list-approvals.use-case';
import { MoveTaskStageUseCase } from './application/use-cases/move-task-stage.use-case';
import { RetryTaskUseCase } from './application/use-cases/retry-task.use-case';
import { ScheduleTasksUseCase } from './application/use-cases/schedule-tasks.use-case';
import { SessionEventRecorder } from './application/use-cases/session-event-recorder';
import { StartTaskTurnUseCase } from './application/use-cases/start-task-turn.use-case';
import { StepReviewLauncher } from './application/use-cases/step-review-launcher';
import { TaskCheckpoints } from './application/use-cases/task-checkpoints';
import { TaskHandover } from './application/use-cases/task-handover';
import { TaskProgression } from './application/use-cases/task-progression';
import { TaskRemoval } from './application/use-cases/task-removal';
import { TaskRunRegistry } from './application/use-cases/task-run-registry';
import {
  STAFF_DIRECTORY,
  TASK_WORKSPACE,
  TEST_COMMAND_RUNNER,
} from './application/ports/task-execution.ports';
import { APPROVAL_REPOSITORY } from './domain/repositories/approval.repository';
import {
  CHECKPOINT_REPOSITORY,
  LINE_COMMENT_REPOSITORY,
} from './domain/repositories/checkpoint.repository';
import { TASK_DELEGATION_REPOSITORY } from './domain/repositories/task-delegation.repository';
import { AgentReconfigurationSubscriber } from './infrastructure/adapters/agent-reconfiguration.subscriber';
import { GitTaskWorkspace } from './infrastructure/adapters/git-task-workspace';
import { ShellTestCommandRunner } from './infrastructure/adapters/shell-test-command-runner';
import { TaskSchedulerLoop } from './infrastructure/adapters/task-scheduler.loop';
import { SqliteApprovalRepository } from './infrastructure/persistence/sqlite-approval.repository';
import {
  SqliteCheckpointRepository,
  SqliteLineCommentRepository,
} from './infrastructure/persistence/sqlite-checkpoint.repository';
import {
  SqliteStaffDirectory,
  SqliteTaskDelegationRepository,
} from './infrastructure/persistence/sqlite-task-execution-records';
import { ApprovalsController } from './presentation/controllers/approvals.controller';
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
  imports: [DepartmentsModule, AgentsModule, ProvidersModule, TracingModule],
  controllers: [
    WorkflowsController,
    TasksController,
    WorkspaceController,
    ApprovalsController,
    MonitorController,
    PreviewController,
  ],
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
    { provide: APPROVAL_REPOSITORY, useClass: SqliteApprovalRepository },
    { provide: CHECKPOINT_REPOSITORY, useClass: SqliteCheckpointRepository },
    { provide: LINE_COMMENT_REPOSITORY, useClass: SqliteLineCommentRepository },
    { provide: TASK_DELEGATION_REPOSITORY, useClass: SqliteTaskDelegationRepository },
    { provide: STAFF_DIRECTORY, useClass: SqliteStaffDirectory },
    { provide: TASK_WORKSPACE, useClass: GitTaskWorkspace },
    { provide: TEST_COMMAND_RUNNER, useClass: ShellTestCommandRunner },
    { provide: PREVIEW_PROCESS_LAUNCHER, useClass: ShellPreviewProcessLauncher },
    { provide: LOCAL_PORT_PROBE, useClass: NodeLocalPortProbe },
    { provide: AGENT_TILE_QUERY, useClass: SqliteAgentTileQuery },
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
    TaskRunRegistry,
    TaskProgression,
    ApprovalRequests,
    ApprovalPresenter,
    TaskRemoval,
    TaskCheckpoints,
    TaskHandover,
    SessionEventRecorder,
    StepReviewLauncher,
    FinishTaskTurnUseCase,
    StartTaskTurnUseCase,
    ScheduleTasksUseCase,
    TaskSchedulerLoop,
    AgentReconfigurationSubscriber,
    ListApprovalsUseCase,
    DecideApprovalUseCase,
    DelegateTaskToSubordinateUseCase,
    AutoDelegateByWorkloadUseCase,
    MoveTaskStageUseCase,
    RetryTaskUseCase,
    TaskWorkspaceAccess,
    ListAgentTilesUseCase,
    ListDelegatedTasksUseCase,
    ListWorkspaceTreeUseCase,
    ReadWorkspaceFileUseCase,
    ListCheckpointsUseCase,
    BuildCheckpointDiffUseCase,
    BuildTaskDiffUseCase,
    ListLineCommentsUseCase,
    AddLineCommentUseCase,
    SubmitCodeReviewUseCase,
    RevertWorkspaceFileUseCase,
    TaskPreviewRegistry,
    StartTaskPreviewUseCase,
    StopTaskPreviewUseCase,
    PauseTaskUseCase,
    ResumeTaskUseCase,
  ],
})
export class OrchestrationModule {}
