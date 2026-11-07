import { Inject, Injectable } from '@nestjs/common';
import type { TaskDetail } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { GetTaskDetailUseCase, requireTaskExists } from './get-task-detail.use-case';

/** "Chạy lại" a failed task: the step it failed on starts over with fresh retries. */
@Injectable()
export class RetryTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  retryTask(taskId: string): TaskDetail {
    const task = requireTaskExists(this.taskRepository, taskId);
    if (task.status !== 'failed') {
      throw new ConflictError('Chỉ chạy lại được task đã thất bại.', { code: 'TASK_NOT_FAILED' });
    }
    task.clearEngineFailures();
    task.requeue({ stepId: task.currentStepId, retriesUsed: 0, note: 'Bạn cho chạy lại.' });
    this.eventLog.recordTaskEvent({ taskId, agentId: null, kind: 'task_retried', payload: {} });
    this.taskRepository.updateTask(task);
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
