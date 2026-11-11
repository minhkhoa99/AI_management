import { Inject, Injectable } from '@nestjs/common';
import { buildCompletionGoal, type AgentProvider } from '@aiteam/contracts';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  AgentSessionSupervisor,
  type TerminalEngineEvent,
} from '../../../../shared/runtime/agent-session-supervisor';
import { ROLE_LABELS_FOR_PROMPTS } from '../../domain/role-labels';
import { formatTaskCode, type Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import { interpretAgentReport } from '../../domain/agent-report';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { findSuperior } from '../../domain/step-assignee';
import { buildReviewPrompt } from '../../domain/step-prompt';
import {
  AGENT_RUN_PREPARER,
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  type AgentRunPreparer,
  type StaffDirectory,
  type TaskEventLog,
} from '../ports/task-execution.ports';
import { ApprovalRequests } from './approval-requests';
import {
  buildQuotaWaitNote,
  QuotaWaitPlanner,
  reloadTaskAfterQuotaRead,
} from './quota-wait-planner';
import { SessionEventRecorder } from './session-event-recorder';
import { TaskProgression } from './task-progression';
import { TaskRemoval } from './task-removal';
import { TaskRunRegistry } from './task-run-registry';

/** Who reviews, with the engine and model the review session started on. */
interface ReviewerEngine {
  agentId: string;
  name: string;
  provider: AgentProvider;
  model: string | null;
}

/**
 * Gate "Cấp trên duyệt": the superior of whoever did the step reviews it in a read-only session
 * and answers pass or fail. Without an available superior (or if the review cannot run), the
 * user approves instead. A review stopped by the reviewer's plan quota waits for the reset and
 * is opened again (StartTaskTurnUseCase).
 */
@Injectable()
export class StepReviewLauncher {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(AGENT_RUN_PREPARER) private readonly runPreparer: AgentRunPreparer,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly sessionSupervisor: AgentSessionSupervisor,
    private readonly runRegistry: TaskRunRegistry,
    private readonly progression: TaskProgression,
    private readonly approvalRequests: ApprovalRequests,
    private readonly sessionEventRecorder: SessionEventRecorder,
    private readonly taskRemoval: TaskRemoval,
    private readonly quotaWaitPlanner: QuotaWaitPlanner,
  ) {}

  /** Starts the review, or asks the user; the caller must not touch the task afterwards. */
  startStepReview(
    task: Task,
    step: WorkflowStepState,
    worker: { agentId: string; name: string },
    workerSummary: string,
    workDirectory: string,
  ): void {
    const state = task.toState();
    const worktreeRoot = state.worktreePath;
    if (worktreeRoot === null) {
      // A worker turn always remembers its worktree; without one there is nothing to review in.
      this.askUserInstead(task, step, worker, workerSummary, 'không tìm thấy thư mục làm việc');
      return;
    }
    const staff = this.staffDirectory.listDepartmentStaff(state.departmentId);
    const superior = findSuperior(worker.agentId, staff);
    const superiorSnapshot =
      superior?.available === true
        ? this.staffDirectory.readEngineSnapshot(superior.agentId)
        : undefined;
    if (superiorSnapshot === undefined) {
      this.askUserInstead(task, step, worker, workerSummary, 'không có cấp trên đang bật');
      return;
    }

    let prepared;
    try {
      // A review only reads: whatever the superior's own permissions are.
      prepared = this.runPreparer.prepareAgentRun({
        ...superiorSnapshot,
        accessLevel: 'read_only',
      });
    } catch (error) {
      this.logger.warn({ err: error, taskId: task.id }, 'review session could not be prepared');
      this.askUserInstead(task, step, worker, workerSummary, 'cấp trên không chạy được');
      return;
    }
    const prompt = buildReviewPrompt({
      taskCode: formatTaskCode(state.sequenceNumber),
      title: state.title,
      goal: buildCompletionGoal({
        description: state.description,
        criteria: state.criteria,
        qaDocuments: this.attachmentRepository.listAttachments(task.id),
      }),
      stepName: step.name,
      requiredOutput: step.requiredOutput,
      workerName: worker.name,
      workerSummary,
      reviewerRoleLabel: `${ROLE_LABELS_FOR_PROMPTS[superiorSnapshot.role]} ${superiorSnapshot.name}`,
    });
    this.taskRepository.updateTask(task);
    this.runRegistry.reserveRun(task.id, superiorSnapshot.agentId, 'review', workDirectory);
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: superiorSnapshot.agentId,
      kind: 'review_started',
      payload: { stepName: step.name, agentName: superiorSnapshot.name },
    });
    const sessionId = this.sessionSupervisor.startSupervisedSession({
      ownerLabel: `review:${task.id}`,
      openSession: (signal) =>
        prepared.engine.startSession(
          {
            prompt,
            workingDirectory: workDirectory,
            workspaceRoot: worktreeRoot,
            model: prepared.model,
            permissions: prepared.permissions,
            resumeSessionRef: null,
            apiConnection: prepared.apiConnection,
          },
          signal,
        ),
      receiveSessionEvent: (event) =>
        this.sessionEventRecorder.recordSessionEvent(task.id, superiorSnapshot.agentId, event, {
          keepSessionRef: false,
          worktreePath: state.worktreePath,
          workDirectory,
        }),
      finishSession: (terminal) =>
        this.finishStepReview(task.id, terminal, step, worker, workerSummary, {
          agentId: superiorSnapshot.agentId,
          name: superiorSnapshot.name,
          provider: superiorSnapshot.provider,
          model: superiorSnapshot.model,
        }),
    });
    this.runRegistry.attachStopHandle(task.id, () =>
      this.sessionSupervisor.cancelSupervisedSession(sessionId),
    );
  }

  private async finishStepReview(
    taskId: string,
    terminal: TerminalEngineEvent,
    step: WorkflowStepState,
    worker: { agentId: string; name: string },
    workerSummary: string,
    reviewer: ReviewerEngine,
  ): Promise<void> {
    const stopReason = this.runRegistry.releaseRun(taskId);
    const task = this.taskRepository.findTaskById(taskId);
    if (task === undefined) return;
    if (stopReason === 'delete') {
      await this.taskRemoval.removeTask(task);
      return;
    }
    // A rate-limited review is followed by the planner's fresh quota read: no second CLI read.
    const quotaReadFollows =
      terminal.kind === 'failed' && terminal.code === 'RATE_LIMITED' && stopReason !== 'pause';
    if (!quotaReadFollows) this.quotaWaitPlanner.requestQuotaRefreshAfterTurn(reviewer.provider);
    if (stopReason === 'pause') {
      task.pause();
      this.taskRepository.updateTask(task);
      return;
    }
    if (terminal.kind === 'failed' && terminal.code === 'RATE_LIMITED') {
      const current = await this.waitForReviewQuota(task, terminal, reviewer);
      if (current !== undefined) {
        this.askUserInstead(
          current,
          step,
          worker,
          workerSummary,
          `${reviewer.name} không duyệt được`,
        );
      }
      return;
    }
    if (terminal.kind !== 'completed') {
      this.askUserInstead(task, step, worker, workerSummary, `${reviewer.name} không duyệt được`);
      return;
    }
    const report = interpretAgentReport(terminal.summary);
    const passed = report.outcome === 'pass';
    this.eventLog.recordTaskEvent({
      taskId,
      agentId: reviewer.agentId,
      kind: 'review_finished',
      payload: { stepName: step.name, agentName: reviewer.name, passed, summary: report.summary },
    });
    this.progression.applyGateResult(
      task,
      passed,
      passed ? null : `${reviewer.name} (cấp trên) yêu cầu sửa: ${report.summary}`,
    );
    this.taskRepository.updateTask(task);
  }

  /**
   * The reviewer's plan quota is used up: the task waits for the reset, then the review is opened
   * again. A review only reads, so there is no checkpoint to save. The quota read is slow, so the
   * outcome goes to the task as stored after it. Returns that task when the quota is not used up
   * (the caller asks the user); undefined when it now waits or changed meanwhile (left alone).
   */
  private async waitForReviewQuota(
    task: Task,
    terminal: Extract<TerminalEngineEvent, { kind: 'failed' }>,
    reviewer: ReviewerEngine,
  ): Promise<Task | undefined> {
    const assigneeBeforeRead = task.assigneeAgentId;
    const wait = await this.quotaWaitPlanner.planQuotaWait(reviewer);
    const current = reloadTaskAfterQuotaRead(this.taskRepository, task.id, assigneeBeforeRead);
    if (current === undefined || wait === null) return current;
    this.eventLog.recordTaskEvent({
      taskId: current.id,
      agentId: reviewer.agentId,
      kind: 'quota_wait',
      payload: {
        engine: wait.engineLabel,
        windowLabel: wait.windowLabel,
        runAfter: wait.runAfter,
        code: terminal.code,
        message: terminal.message,
        reviewerName: reviewer.name,
      },
    });
    current.waitForReviewQuota({ runAfter: wait.runAfter, note: buildQuotaWaitNote(wait) });
    this.taskRepository.updateTask(current);
    return undefined;
  }

  private askUserInstead(
    task: Task,
    step: WorkflowStepState,
    worker: { agentId: string; name: string },
    workerSummary: string,
    reason: string,
  ): void {
    this.approvalRequests.requestApproval(task, {
      kind: 'step_gate',
      summary: `Bước "${step.name}": ${reason}, chờ bạn duyệt`,
      request: workerSummary,
      step: { id: step.id, name: step.name },
      agent: { id: worker.agentId, name: worker.name },
    });
    this.taskRepository.updateTask(task);
  }
}
