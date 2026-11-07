import { Inject, Injectable } from '@nestjs/common';
import type { TaskDetail } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { GetTaskDetailUseCase, requireTaskExists } from './get-task-detail.use-case';
import { TaskRunRegistry } from './task-run-registry';

/**
 * "Tạm dừng": a running turn stops now (a checkpoint is saved when it ends), a queued task
 * simply waits. The engine session is kept so "Tiếp tục" picks up where it was.
 */
@Injectable()
export class PauseTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly runRegistry: TaskRunRegistry,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  pauseTask(taskId: string): TaskDetail {
    const task = requireTaskExists(this.taskRepository, taskId);
    if (this.runRegistry.requestStop(taskId, 'pause')) {
      return this.getTaskDetailUseCase.getTaskDetail(taskId);
    }
    if (task.status !== 'queued') {
      throw new ConflictError('Chỉ tạm dừng được task đang chạy hoặc đang chờ trong hàng.', {
        code: 'TASK_NOT_PAUSABLE',
      });
    }
    task.pause();
    this.taskRepository.updateTask(task);
    this.eventLog.recordTaskEvent({ taskId, agentId: null, kind: 'task_paused', payload: {} });
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
