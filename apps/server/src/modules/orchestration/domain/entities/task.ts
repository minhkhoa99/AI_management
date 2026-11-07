import {
  FINISHED_TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  type TaskPriority,
  type TaskStatus,
} from '@aiteam/contracts';
import { DisplayName } from '../../../../shared/domain/display-name';
import { ConflictError } from '../../../../shared/errors/app-error';

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
}

export interface TaskContent {
  title: string;
  description: string;
  criteria: string;
  priority: TaskPriority;
  testCommand: string | null;
}

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

  toState(): TaskState {
    return { ...this.state };
  }

  private assertNotStarted(fieldLabel: string): void {
    if (this.state.status !== 'queued') {
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
