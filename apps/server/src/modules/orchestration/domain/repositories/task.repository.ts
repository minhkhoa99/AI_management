import type { Task } from '../entities/task';

export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');

export interface TaskRepository {
  findTaskById(taskId: string): Task | undefined;
  /** Next free "T-<n>" number; call inside the transaction that inserts the task. */
  allocateSequenceNumber(): number;
  insertTask(task: Task): void;
  updateTask(task: Task): void;
  deleteTask(taskId: string): void;
  /** Queued tasks of enabled departments whose back-off has passed: priority, then oldest. */
  listRunnableTaskIds(nowIso: string): string[];
  /** Subtasks of a task, oldest first. */
  listSubtaskIds(parentTaskId: string): string[];
  /** Tasks waiting for subtasks of which none is left unfinished. */
  listParentIdsReadyToResume(): string[];
  /** Queued tasks assigned to the agent, whatever their back-off. */
  listQueuedTaskIdsAssignedTo(agentId: string): string[];
  /** Queued tasks whose next turn is a superior's review (the reviewer is not stored). */
  listQueuedTaskIdsWaitingForReview(): string[];
}
