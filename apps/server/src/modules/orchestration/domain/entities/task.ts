import {
  FINISHED_TASK_STATUSES,
  PREVIEW_PORT_PLACEHOLDER,
  TASK_TITLE_MAX_LENGTH,
  type AccessLevel,
  type AgentProvider,
  type TaskPriority,
  type TaskStatus,
} from '@aiteam/contracts';
import { DisplayName } from '../../../../shared/domain/display-name';
import { ConflictError, ValidationError } from '../../../../shared/errors/app-error';

/** Engine configuration of the agent when its session started; the session keeps using it. */
export interface EngineSnapshot {
  agentId: string;
  provider: AgentProvider;
  connectionId: string | null;
  model: string | null;
  accessLevel: AccessLevel;
  networkAccess: boolean;
}

export interface TaskState {
  id: string;
  sequenceNumber: number;
  departmentId: string;
  workflowId: string | null;
  title: string;
  description: string;
  criteria: string;
  priority: TaskPriority;
  assigneeAgentId: string | null;
  currentStepId: string | null;
  status: TaskStatus;
  workingDirectory: string | null;
  sessionRef: string | null;
  testCommand: string | null;
  previewCommand: string | null;
  engineSnapshot: EngineSnapshot | null;
  /** Retries used on the current step (on_fail = retry). */
  stepAttempt: number;
  /** Consecutive retryable engine failures; reset by any completed turn. */
  engineFailures: number;
  /** ISO time before which the scheduler leaves the task alone (retry back-off). */
  runAfter: string | null;
  worktreePath: string | null;
  pendingFeedback: string | null;
  statusNote: string | null;
  /** Commit the task branch started from (diffs "since start", file reverts). */
  baseSha: string | null;
  /** Set on a subtask: the task whose agent split its step into this one (one level deep). */
  parentTaskId: string | null;
  /** The superior's review of the current step waits for the plan quota: reopen it next turn. */
  reviewPending: boolean;
}

export interface TaskContent {
  title: string;
  description: string;
  criteria: string;
  priority: TaskPriority;
  testCommand: string | null;
  previewCommand: string | null;
}

export const FEEDBACK_MAX_LENGTH = 8_000;

/** Every status note of a task waiting for a plan quota reset starts with this. */
export const QUOTA_WAIT_NOTE_PREFIX = '⏸ Chờ hạn mức';

/** A unit of work for a department: what to do, who does it, where, and how far it got. */
export class Task {
  private constructor(private state: TaskState) {}

  static createNew(
    input: TaskContent & {
      id: string;
      sequenceNumber: number;
      departmentId: string;
      workflowId: string | null;
      assigneeAgentId: string;
      workingDirectory: string | null;
    },
  ): Task {
    return new Task({
      id: input.id,
      sequenceNumber: input.sequenceNumber,
      departmentId: input.departmentId,
      workflowId: input.workflowId,
      title: parseTaskTitle(input.title),
      description: input.description.trim(),
      criteria: input.criteria.trim(),
      priority: input.priority,
      assigneeAgentId: input.assigneeAgentId,
      currentStepId: null,
      status: 'queued',
      workingDirectory: input.workingDirectory,
      sessionRef: null,
      testCommand: normaliseTestCommand(input.testCommand),
      previewCommand: parsePreviewCommand(input.previewCommand),
      engineSnapshot: null,
      stepAttempt: 0,
      engineFailures: 0,
      runAfter: null,
      worktreePath: null,
      pendingFeedback: null,
      statusNote: null,
      baseSha: null,
      parentTaskId: null,
      reviewPending: false,
    });
  }

  /**
   * A piece of `parent`'s current step, done by one subordinate without a workflow. It works in
   * its own worktree forked from the parent's, in the same folder, with the parent's priority.
   */
  static createSubtask(input: {
    id: string;
    sequenceNumber: number;
    parent: TaskState;
    title: string;
    description: string;
    assigneeAgentId: string;
  }): Task {
    const subtask = Task.createNew({
      id: input.id,
      sequenceNumber: input.sequenceNumber,
      departmentId: input.parent.departmentId,
      workflowId: null,
      title: input.title,
      description: input.description,
      criteria: '',
      priority: input.parent.priority,
      assigneeAgentId: input.assigneeAgentId,
      workingDirectory: input.parent.workingDirectory,
      testCommand: null,
      previewCommand: input.parent.previewCommand,
    });
    subtask.state.parentTaskId = input.parent.id;
    return subtask;
  }

  /** Rebuilds a task loaded from storage (already validated when it was saved). */
  static restore(state: TaskState): Task {
    return new Task({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get departmentId(): string {
    return this.state.departmentId;
  }

  get status(): TaskStatus {
    return this.state.status;
  }

  get assigneeAgentId(): string | null {
    return this.state.assigneeAgentId;
  }

  get currentStepId(): string | null {
    return this.state.currentStepId;
  }

  get parentTaskId(): string | null {
    return this.state.parentTaskId;
  }

  get isSubtask(): boolean {
    return this.state.parentTaskId !== null;
  }

  get isFinished(): boolean {
    return (FINISHED_TASK_STATUSES as readonly TaskStatus[]).includes(this.state.status);
  }

  /** Title, description, criteria, priority and commands can change at any time. */
  editContent(changes: Partial<TaskContent>): void {
    if (changes.title !== undefined) this.state.title = parseTaskTitle(changes.title);
    if (changes.description !== undefined) this.state.description = changes.description.trim();
    if (changes.criteria !== undefined) this.state.criteria = changes.criteria.trim();
    if (changes.priority !== undefined) this.state.priority = changes.priority;
    if (changes.testCommand !== undefined) {
      this.state.testCommand = normaliseTestCommand(changes.testCommand);
    }
    if (changes.previewCommand !== undefined) {
      this.state.previewCommand = parsePreviewCommand(changes.previewCommand);
    }
  }

  /**
   * A queued task that waited for a quota reset (or a retry back-off) runs at once under its new
   * assignee, and a reopened review of the old worker's report is dropped: the new one does the step.
   */
  assignTo(agentId: string): void {
    this.state.assigneeAgentId = agentId;
    if (this.state.status === 'queued') {
      this.clearRunAfter();
      this.state.reviewPending = false;
    }
  }

  /** The back-off or quota wait is over (the engine changed): the scheduler may pick the task now. */
  clearRunAfter(): void {
    this.state.runAfter = null;
    if (this.state.statusNote?.startsWith(QUOTA_WAIT_NOTE_PREFIX) === true) {
      this.state.statusNote = null;
    }
  }

  /** The workflow and the folder are fixed once work has started. */
  changeWorkflow(workflowId: string | null): void {
    this.assertNotStarted('Quy trình');
    this.state.workflowId = workflowId;
    this.state.currentStepId = null;
  }

  changeWorkingDirectory(workingDirectory: string | null): void {
    this.assertNotStarted('Thư mục làm việc');
    this.state.workingDirectory = workingDirectory;
  }

  // ---- Execution ----------------------------------------------------------------------------

  rememberWorktree(worktreePath: string, baseSha: string | null): void {
    this.state.worktreePath = worktreePath;
    this.state.baseSha ??= baseSha;
  }

  /** Stopped by the user: the scheduler leaves it alone, the engine session is kept. */
  pause(): void {
    this.state.status = 'paused';
    this.state.statusNote = 'Bạn đã tạm dừng task.';
  }

  /** Back in the queue on the same step; the same agent continues its session. */
  resume(): void {
    this.state.status = 'queued';
    this.state.statusNote = null;
    this.state.runAfter = null;
  }

  /** An agent session starts on `stepId` (null: no workflow) with the agent's current engine. */
  startTurn(stepId: string | null, snapshot: EngineSnapshot): void {
    this.state.status = 'running';
    this.state.reviewPending = false;
    this.state.currentStepId = stepId;
    this.state.assigneeAgentId = snapshot.agentId;
    this.state.engineSnapshot = snapshot;
    this.state.runAfter = null;
    this.state.statusNote = null;
  }

  /** The engine announced its session id (Claude session / Codex thread). */
  recordSessionRef(sessionRef: string): void {
    this.state.sessionRef = sessionRef;
  }

  /** The feedback was handed to an agent; it is not repeated in later turns. */
  consumeFeedback(): string | null {
    const feedback = this.state.pendingFeedback;
    this.state.pendingFeedback = null;
    return feedback;
  }

  addFeedback(feedback: string): void {
    const combined = [this.state.pendingFeedback, feedback.trim()]
      .filter((part): part is string => part !== null && part !== '')
      .join('\n\n');
    this.state.pendingFeedback = combined.slice(-FEEDBACK_MAX_LENGTH);
  }

  /** Back in the queue on `stepId`; `retriesUsed` counts on_fail retries of that step. */
  requeue(input: {
    stepId: string | null;
    retriesUsed: number;
    runAfter?: string;
    note?: string;
  }): void {
    this.state.status = 'queued';
    this.state.reviewPending = false;
    this.state.currentStepId = input.stepId;
    this.state.stepAttempt = input.retriesUsed;
    this.state.runAfter = input.runAfter ?? null;
    this.state.statusNote = input.note ?? null;
  }

  /**
   * The engine's plan quota is used up: back in the queue until it resets. Same step, same session,
   * and not an engine failure (the failure counter and the step attempt stay as they were).
   */
  waitForQuota(input: { runAfter: string; note: string }): void {
    this.state.status = 'queued';
    this.state.runAfter = input.runAfter;
    this.state.statusNote = input.note;
  }

  /**
   * The superior's review hit the reviewer's plan quota: back in the queue until it resets, and
   * the next turn opens the review again (the step's work is done and stays as it is).
   */
  waitForReviewQuota(input: { runAfter: string; note: string }): void {
    this.waitForQuota(input);
    this.state.reviewPending = true;
  }

  /** Whether the next turn is the superior's review; the answer is given once. */
  takePendingReview(): boolean {
    const pending = this.state.reviewPending;
    this.state.reviewPending = false;
    return pending;
  }

  /** The reopened review runs: the task is busy again, on the same step and worker. */
  startPendingReview(): void {
    this.state.status = 'running';
    this.state.runAfter = null;
    this.state.statusNote = null;
  }

  /** Returns how many retryable engine failures happened in a row. */
  countEngineFailure(): number {
    this.state.engineFailures += 1;
    return this.state.engineFailures;
  }

  clearEngineFailures(): void {
    this.state.engineFailures = 0;
  }

  /** The agent split its step: the task waits until every subtask is finished. */
  waitForSubtasks(subtaskCount: number): void {
    this.state.status = 'waiting_children';
    this.state.runAfter = null;
    this.state.statusNote = `Chờ ${subtaskCount} task con do cấp dưới làm.`;
  }

  /**
   * Every subtask finished: back in the queue on the same step, so the same agent continues its
   * session with the results (`feedback`) and finishes the step.
   */
  resumeAfterSubtasks(feedback: string): void {
    this.state.status = 'queued';
    this.state.runAfter = null;
    this.state.statusNote = null;
    this.addFeedback(feedback);
  }

  waitForApproval(note: string): void {
    this.state.status = 'waiting_approval';
    this.state.reviewPending = false;
    this.state.statusNote = note;
  }

  succeed(): void {
    this.state.status = 'succeeded';
    this.state.reviewPending = false;
    this.state.statusNote = null;
    this.state.pendingFeedback = null;
  }

  fail(note: string): void {
    this.state.status = 'failed';
    this.state.reviewPending = false;
    this.state.statusNote = note;
  }

  beginCancelling(): void {
    this.state.status = 'cancelling';
    this.state.reviewPending = false;
    this.state.statusNote = 'Đã gửi tín hiệu huỷ, chờ agent dừng…';
  }

  /** The engine or connection changed: the old engine session cannot be continued. */
  forgetEngineSession(handoff: string | null): void {
    this.state.sessionRef = null;
    if (handoff !== null) this.addFeedback(handoff);
  }

  toState(): TaskState {
    return { ...this.state };
  }

  private assertNotStarted(fieldLabel: string): void {
    if (this.state.status !== 'queued' || this.state.worktreePath !== null) {
      throw new ConflictError(`${fieldLabel} chỉ đổi được khi task chưa bắt đầu.`, {
        code: 'TASK_ALREADY_STARTED',
      });
    }
  }
}

function parseTaskTitle(rawTitle: string): string {
  return DisplayName.parse(rawTitle, TASK_TITLE_MAX_LENGTH, 'TASK_TITLE_INVALID').text;
}

function normaliseTestCommand(rawCommand: string | null): string | null {
  const command = rawCommand?.trim() ?? '';
  return command === '' ? null : command;
}

/** Empty means no preview; otherwise the platform needs {port} to give the server a free port. */
function parsePreviewCommand(rawCommand: string | null): string | null {
  const command = normaliseTestCommand(rawCommand);
  if (command !== null && !command.includes(PREVIEW_PORT_PLACEHOLDER)) {
    throw new ValidationError('Lệnh chạy giao diện phải có {port}.', {
      code: 'PREVIEW_COMMAND_NEEDS_PORT',
    });
  }
  return command;
}

export function formatTaskCode(sequenceNumber: number): string {
  return `T-${sequenceNumber}`;
}
