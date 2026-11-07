import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../../shared/errors/app-error';
import type { Task } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { requireTaskExists } from './get-task-detail.use-case';
import { TaskRunRegistry } from './task-run-registry';

/** The worktree of a task, once its first turn prepared it. */
@Injectable()
export class TaskWorkspaceAccess {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    private readonly runRegistry: TaskRunRegistry,
  ) {}

  requireTaskWorktree(taskId: string): { task: Task; worktreePath: string } {
    const task = requireTaskExists(this.taskRepository, taskId);
    const worktreePath = task.toState().worktreePath;
    if (worktreePath === null) {
      throw new ConflictError('Task chưa bắt đầu nên chưa có thư mục làm việc.', {
        code: 'TASK_HAS_NO_WORKSPACE',
      });
    }
    return { task, worktreePath };
  }

  /** Changes to the files (revert, review) wait until no agent works on the task. */
  requireIdleTaskWorktree(taskId: string): { task: Task; worktreePath: string } {
    const access = this.requireTaskWorktree(taskId);
    if (this.runRegistry.isRunning(taskId) || access.task.status === 'cancelling') {
      throw new ConflictError(
        'Agent đang làm việc trên task này. Tạm dừng task hoặc chờ lượt xong rồi thử lại.',
        { code: 'TASK_BUSY' },
      );
    }
    return access;
  }
}
