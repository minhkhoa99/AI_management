import {
  FINISHED_TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  type AccessLevel,
  type AgentProvider,
  type TaskPriority,
  type TaskStatus,
} from '@aiteam/contracts';
import { DisplayName } from '../../../../shared/domain/display-name';
import { ConflictError } from '../../../../shared/errors/app-error';

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
}

export interface TaskContent {
  title: string;
  description: string;
  criteria: string;
  priority: TaskPriority;
  testCommand: string | null;
}

const FEEDBACK_MAX_LENGTH = 8_000;

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
      engineSnapshot: null,
      stepAttempt: 0,
      engineFailures: 0,
      runAfter: null,
      worktreePath: null,
      pendingFeedback: null,
      statusNote: null,
      baseSha: null,
    });
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

  get isFinished(): boolean {
    return (FINISHED_TASK_STATUSES as readonly TaskStatus[]).includes(this.state.status);
  }

  /** Title, description, criteria, priority and test command can change at any time. */
  editContent(changes: Partial<TaskContent>): void {
    if (changes.title !== undefined) this.state.title = parseTaskTitle(changes.title);
    if (changes.description !== undefined) this.state.description = changes.description.trim();
    if (changes.criteria !== undefined) this.state.criteria = changes.criteria.trim();
    if (changes.priority !== undefined) this.state.priority = changes.priority;
    if (changes.testCommand !== undefined) {
      this.state.testCommand = normaliseTestCommand(changes.testCommand);
    }
  }

  assignTo(agentId: string): void {
    this.state.assigneeAgentId = agentId;
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
    this.state.currentStepId = input.stepId;
    this.state.stepAttempt = input.retriesUsed;
    this.state.runAfter = input.runAfter ?? null;
    this.state.statusNote = input.note ?? null;
  }

  /** Returns how many retryable engine failures happened in a row. */
  countEngineFailure(): number {
    this.state.engineFailures += 1;
    return this.state.engineFailures;
  }

  clearEngineFailures(): void {
    this.state.engineFailures = 0;
  }

  waitForApproval(note: string): void {
    this.state.status = 'waiting_approval';
    this.state.statusNote = note;
  }

  succeed(): void {
    this.state.status = 'succeeded';
    this.state.statusNote = null;
    this.state.pendingFeedback = null;
  }

  fail(note: string): void {
    this.state.status = 'failed';
    this.state.statusNote = note;
  }

  beginCancelling(): void {
    this.state.status = 'cancelling';
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

export function formatTaskCode(sequenceNumber: number): string {
  return `T-${sequenceNumber}`;
}
