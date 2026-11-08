import { Inject, Injectable } from '@nestjs/common';
import type { TaskDeletion } from '@aiteam/contracts';
import type { Task } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { requireTaskExists } from './get-task-detail.use-case';
import { TaskRemoval } from './task-removal';
import { TaskRunRegistry } from './task-run-registry';

/**
 * "Xoá task": with nothing running the task is deleted at once (its branch is kept). With an
 * agent at work, the task becomes "cancelling" and the agent's process tree is stopped; the
 * session's end deletes it (cancel signal → engine stops → checkpoint → worktree removed).
 * Deleting a task deletes its subtasks the same way.
 */
@Injectable()
export class DeleteTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly runRegistry: TaskRunRegistry,
    private readonly taskRemoval: TaskRemoval,
  ) {}

  async deleteTask(taskId: string): Promise<TaskDeletion> {
    const task = requireTaskExists(this.taskRepository, taskId);
    for (const subtaskId of this.taskRepository.listSubtaskIds(taskId)) {
      const subtask = this.taskRepository.findTaskById(subtaskId);
      if (subtask !== undefined) await this.deleteOneTask(subtask);
    }
    return this.deleteOneTask(task);
  }

  private async deleteOneTask(task: Task): Promise<TaskDeletion> {
    const taskId = task.id;
    if (this.runRegistry.isRunning(taskId)) {
      task.beginCancelling();
      this.taskRepository.updateTask(task);
      this.eventLog.recordTaskEvent({
        taskId,
        agentId: task.assigneeAgentId,
        kind: 'cancel_requested',
        payload: {},
      });
      this.runRegistry.requestStop(taskId, 'delete');
      return { taskId, outcome: 'cancelling' };
    }
    await this.taskRemoval.removeTask(task);
    return { taskId, outcome: 'deleted' };
  }
}
