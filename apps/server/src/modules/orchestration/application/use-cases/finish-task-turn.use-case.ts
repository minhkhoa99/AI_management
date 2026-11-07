import { Inject, Injectable } from '@nestjs/common';
import type { TerminalEngineEvent } from '../../../../shared/runtime/agent-session-supervisor';
import { interpretAgentReport, type AgentReport } from '../../domain/agent-report';
import { formatTaskCode, type Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  TEST_COMMAND_RUNNER,
  type StaffDirectory,
  type TaskEventLog,
  type TestCommandRunner,
} from '../ports/task-execution.ports';
import { ApprovalRequests } from './approval-requests';
import { StepReviewLauncher } from './step-review-launcher';
import { TaskCheckpoints } from './task-checkpoints';
import { TaskProgression } from './task-progression';
import { TaskRemoval } from './task-removal';
import { TaskRunRegistry } from './task-run-registry';

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
      this.handleEngineFailure(task, terminal);
      this.taskRepository.updateTask(task);
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

  private handleEngineFailure(
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
