import { Inject, Injectable } from '@nestjs/common';
import { localEngineSchema } from '@aiteam/contracts';
import type { TerminalEngineEvent } from '../../../../shared/runtime/agent-session-supervisor';
import { interpretAgentReport, type AgentReport } from '../../domain/agent-report';
import { formatTaskCode, type Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { ENGINE_QUOTA_GATEWAY, type EngineQuotaGateway } from '../ports/engine-quota.port';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  TEST_COMMAND_RUNNER,
  type StaffDirectory,
  type TaskEventLog,
  type TestCommandRunner,
} from '../ports/task-execution.ports';
import { ApprovalRequests } from './approval-requests';
import {
  buildQuotaWaitNote,
  QuotaWaitPlanner,
  reloadTaskAfterQuotaRead,
} from './quota-wait-planner';
import { StepReviewLauncher } from './step-review-launcher';
import { TaskCheckpoints } from './task-checkpoints';
import { TaskProgression } from './task-progression';
import { TaskRemoval } from './task-removal';
import { TaskRunRegistry } from './task-run-registry';
import { TaskSplitter } from './task-splitter';

/** Retryable engine failures (rate limit, CLI not reachable) in a row before the task fails. */
export const MAX_ENGINE_FAILURES = 3;
const ENGINE_RETRY_BASE_DELAY_MS = 30_000;

/**
 * Called by the supervisor when an agent turn ended (never throws into it): saves a checkpoint,
 * reads the agent's report and evaluates the step's gate, which may run the tests, start the
 * superior's review or ask the user.
 */
@Injectable()
export class FinishTaskTurnUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(TEST_COMMAND_RUNNER) private readonly testRunner: TestCommandRunner,
    private readonly runRegistry: TaskRunRegistry,
    private readonly progression: TaskProgression,
    private readonly approvalRequests: ApprovalRequests,
    private readonly checkpoints: TaskCheckpoints,
    private readonly reviewLauncher: StepReviewLauncher,
    private readonly taskRemoval: TaskRemoval,
    private readonly taskSplitter: TaskSplitter,
    private readonly quotaWaitPlanner: QuotaWaitPlanner,
    @Inject(ENGINE_QUOTA_GATEWAY) private readonly quotaGateway: EngineQuotaGateway,
  ) {}

  async finishTaskTurn(taskId: string, terminal: TerminalEngineEvent): Promise<void> {
    const workDirectory = this.runRegistry.workDirectoryOf(taskId);
    const stopReason = this.runRegistry.releaseRun(taskId);
    const task = this.taskRepository.findTaskById(taskId);
    if (task === undefined) return;
    if (stopReason === 'delete') {
      await this.taskRemoval.removeTask(task);
      return;
    }
    const state = task.toState();
    // A rate-limited turn is followed by the planner's fresh quota read: no second CLI read.
    const quotaReadFollows =
      terminal.kind === 'failed' && terminal.code === 'RATE_LIMITED' && stopReason !== 'pause';
    if (!quotaReadFollows) this.requestQuotaRefreshAfterTurn(state.engineSnapshot?.provider);

    if (stopReason === 'pause') {
      await this.checkpoints.saveTaskCheckpoint(task, 'aiteam: lưu mốc khi tạm dừng');
      task.pause();
      this.recordEvent(task, 'task_paused', {});
      this.taskRepository.updateTask(task);
      return;
    }
    if (terminal.kind === 'cancelled') {
      await this.checkpoints.saveTaskCheckpoint(task, 'aiteam: lưu mốc khi dừng lượt');
      task.requeue({
        stepId: state.currentStepId,
        retriesUsed: state.stepAttempt,
        note:
          stopReason === 'reconfigure'
            ? 'Quyền của agent vừa giảm: lượt bị dừng và sẽ chạy lại với quyền mới.'
            : 'Lượt bị dừng; sẽ chạy lại.',
      });
      this.recordEvent(task, 'turn_cancelled', { reason: stopReason });
      this.taskRepository.updateTask(task);
      return;
    }
    if (terminal.kind === 'failed') {
      await this.handleEngineFailure(task, terminal);
      return;
    }

    task.clearEngineFailures();
    const report = interpretAgentReport(terminal.summary);
    const step = this.findCurrentStep(task);
    const agent =
      state.assigneeAgentId === null
        ? undefined
        : this.staffDirectory.readEngineSnapshot(state.assigneeAgentId);
    const agentName = agent?.name ?? 'Agent';
    this.eventLog.recordTaskEvent({
      taskId,
      agentId: state.assigneeAgentId,
      kind: 'step_report',
      payload: {
        stepKey: step?.id ?? 'task',
        stepName: step?.name ?? 'Thực hiện task',
        agentName,
        outcome: report.outcome,
        summary: report.summary,
        wellFormed: report.wellFormed,
      },
    });
    await this.checkpoints.saveTaskCheckpoint(
      task,
      `${formatTaskCode(state.sequenceNumber)} ${step?.name ?? state.title}: ${firstLine(report.summary)}`,
    );

    // The agent handed parts of its step to subordinates: the step is judged when they are done.
    if (this.taskSplitter.splitTaskIfRequested(task, report, state.assigneeAgentId ?? '')) {
      return;
    }
    if (report.outcome === 'needs_approval') {
      this.approvalRequests.requestApproval(task, {
        kind: 'sensitive_action',
        summary: `${agentName} xin duyệt việc nhạy cảm`,
        request: report.approvalRequest ?? report.summary,
        step: step === undefined ? null : { id: step.id, name: step.name },
        agent:
          state.assigneeAgentId === null ? null : { id: state.assigneeAgentId, name: agentName },
      });
      this.taskRepository.updateTask(task);
      return;
    }
    if (step === undefined) {
      this.progression.applyGateResult(task, report.outcome !== 'fail', failureFeedback(report));
      this.taskRepository.updateTask(task);
      return;
    }
    await this.evaluateStepGate(task, step, report, {
      agentId: state.assigneeAgentId ?? '',
      name: agentName,
      workDirectory: workDirectory ?? state.worktreePath ?? '',
    });
  }

  private async evaluateStepGate(
    task: Task,
    step: WorkflowStepState,
    report: AgentReport,
    worker: { agentId: string; name: string; workDirectory: string },
  ): Promise<void> {
    if (report.outcome === 'fail') {
      this.applyGate(task, step, false, failureFeedback(report));
      return;
    }
    switch (step.gate) {
      case 'auto':
        this.applyGate(task, step, true, null);
        return;
      case 'qc_pass':
        this.applyGate(
          task,
          step,
          report.outcome === 'pass',
          report.outcome === 'pass' ? null : `QC chưa xác nhận đạt: ${report.summary}`,
        );
        return;
      case 'tests_pass':
        await this.runTestsGate(task, step, worker.workDirectory);
        return;
      case 'lead_approval':
        this.reviewLauncher.startStepReview(
          task,
          step,
          worker,
          report.summary,
          worker.workDirectory,
        );
        return;
      case 'user_approval':
        this.approvalRequests.requestApproval(task, {
          kind: 'step_gate',
          summary: `Bước "${step.name}": chờ bạn duyệt`,
          request: report.summary,
          step: { id: step.id, name: step.name },
          agent: { id: worker.agentId, name: worker.name },
        });
        this.taskRepository.updateTask(task);
        return;
    }
  }

  private async runTestsGate(task: Task, step: WorkflowStepState, workDirectory: string) {
    const testCommand = task.toState().testCommand;
    if (testCommand === null) {
      this.applyGate(
        task,
        step,
        true,
        null,
        'Task chưa có lệnh kiểm thử: dựa vào báo cáo của agent.',
      );
      return;
    }
    this.taskRepository.updateTask(task);
    const controller = new AbortController();
    this.runRegistry.reserveRun(task.id, null, 'tests', workDirectory);
    this.runRegistry.attachStopHandle(task.id, () => controller.abort());
    const result = await this.testRunner.runTestCommand(
      testCommand,
      workDirectory,
      controller.signal,
    );
    const stopReason = this.runRegistry.releaseRun(task.id);
    const current = this.taskRepository.findTaskById(task.id);
    if (current === undefined) return;
    if (stopReason === 'delete') {
      await this.taskRemoval.removeTask(current);
      return;
    }
    if (stopReason === 'pause') {
      current.pause();
      this.taskRepository.updateTask(current);
      return;
    }
    this.applyGate(
      current,
      step,
      result.passed,
      result.passed
        ? null
        : `Lệnh kiểm thử "${testCommand}" chưa pass (exit ${result.exitCode ?? 'không rõ'}):\n${result.outputTail}`,
    );
  }

  private applyGate(
    task: Task,
    step: WorkflowStepState,
    passed: boolean,
    feedback: string | null,
    detail: string | null = null,
  ) {
    this.recordEvent(task, 'gate_evaluated', {
      gate: step.gate,
      passed,
      detail: detail ?? feedback,
    });
    this.progression.applyGateResult(task, passed, feedback);
    this.taskRepository.updateTask(task);
  }

  private requestQuotaRefreshAfterTurn(provider: string | undefined): void {
    const engine = localEngineSchema.safeParse(provider);
    if (engine.success) this.quotaGateway.requestEngineQuotaRefresh(engine.data);
  }

  /**
   * A rate limit that is really the plan quota waits for the reset instead of failing; anything
   * else takes the retry back-off. The quota read is slow and no run is registered meanwhile, so
   * the outcome is applied to the task as stored after it (and again after the checkpoint), never
   * to the copy loaded before: a handover or an edit made in between is kept.
   */
  private async handleEngineFailure(
    task: Task,
    terminal: Extract<TerminalEngineEvent, { kind: 'failed' }>,
  ): Promise<void> {
    const snapshot = task.toState().engineSnapshot;
    if (!terminal.retryable || terminal.code !== 'RATE_LIMITED' || snapshot === null) {
      this.applyEngineFailure(task, terminal);
      this.taskRepository.updateTask(task);
      return;
    }
    const assigneeBeforeRead = task.assigneeAgentId;
    const wait = await this.quotaWaitPlanner.planQuotaWait(snapshot);
    const current = reloadTaskAfterQuotaRead(this.taskRepository, task.id, assigneeBeforeRead);
    if (current === undefined) return;
    if (wait === null) {
      this.applyEngineFailure(current, terminal);
      this.taskRepository.updateTask(current);
      return;
    }
    await this.checkpoints.saveTaskCheckpoint(current, 'aiteam: lưu mốc khi hết hạn mức');
    const latest = reloadTaskAfterQuotaRead(this.taskRepository, task.id, assigneeBeforeRead);
    if (latest === undefined) return;
    // A quota wait is one timeline line (quota_wait); engine_failed only on the other paths.
    this.recordEvent(latest, 'quota_wait', {
      engine: wait.engineLabel,
      windowLabel: wait.windowLabel,
      runAfter: wait.runAfter,
      code: terminal.code,
      message: terminal.message,
    });
    latest.waitForQuota({ runAfter: wait.runAfter, note: buildQuotaWaitNote(wait) });
    this.taskRepository.updateTask(latest);
  }

  /** The old back-off: retry after 30 s, 60 s, 120 s, then fail; non-retryable fails at once. */
  private applyEngineFailure(
    task: Task,
    terminal: Extract<TerminalEngineEvent, { kind: 'failed' }>,
  ): void {
    const state = task.toState();
    this.recordEvent(task, 'engine_failed', { code: terminal.code, message: terminal.message });
    if (!terminal.retryable) {
      task.fail(`Bộ não báo lỗi (${terminal.code}): ${terminal.message}`);
      return;
    }
    const failures = task.countEngineFailure();
    if (failures > MAX_ENGINE_FAILURES) {
      task.fail(`Bộ não lỗi ${failures} lần liên tiếp (${terminal.code}): ${terminal.message}`);
      return;
    }
    const delayMs = ENGINE_RETRY_BASE_DELAY_MS * 2 ** (failures - 1);
    task.requeue({
      stepId: state.currentStepId,
      retriesUsed: state.stepAttempt,
      runAfter: new Date(Date.now() + delayMs).toISOString(),
      note: `Bộ não tạm lỗi (${terminal.code}); thử lại sau ${Math.round(delayMs / 1000)} giây.`,
    });
  }

  private findCurrentStep(task: Task): WorkflowStepState | undefined {
    const state = task.toState();
    const route = this.progression.resolveTaskRoute(state.workflowId);
    return route?.steps.find((step) => step.id === state.currentStepId);
  }

  private recordEvent(task: Task, kind: string, payload: Record<string, unknown>): void {
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: task.assigneeAgentId,
      kind,
      payload,
    });
  }
}

function failureFeedback(report: AgentReport): string | null {
  return report.outcome === 'fail' ? `Agent báo không hoàn thành: ${report.summary}` : null;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/)[0]?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
