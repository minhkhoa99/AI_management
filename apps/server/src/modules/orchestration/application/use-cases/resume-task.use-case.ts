import { Inject, Injectable } from '@nestjs/common';
import type { TaskDetail } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { GetTaskDetailUseCase, requireTaskExists } from './get-task-detail.use-case';

/** "Tiếp tục": back in the queue on the same step; the same agent continues its session. */
@Injectable()
export class ResumeTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  resumeTask(taskId: string): TaskDetail {
    const task = requireTaskExists(this.taskRepository, taskId);
    if (task.status !== 'paused') {
      throw new ConflictError('Task không ở trạng thái tạm dừng.', { code: 'TASK_NOT_PAUSED' });
    }
    task.resume();
    this.taskRepository.updateTask(task);
    this.eventLog.recordTaskEvent({ taskId, agentId: null, kind: 'task_resumed', payload: {} });
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
