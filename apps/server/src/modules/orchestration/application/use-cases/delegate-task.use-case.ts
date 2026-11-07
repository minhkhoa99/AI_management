import { Injectable } from '@nestjs/common';
import type { TaskDetail } from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { GetTaskDetailUseCase } from './get-task-detail.use-case';
import { TaskHandover } from './task-handover';

/** "Giao" a task to one of the assignee's direct subordinates. */
@Injectable()
export class DelegateTaskToSubordinateUseCase {
  constructor(
    private readonly taskHandover: TaskHandover,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  delegateTask(taskId: string, toAgentId: string): TaskDetail {
    const task = this.taskHandover.requireDelegableTask(taskId);
    const target = this.taskHandover
      .listDelegationTargets(task)
      .find((member) => member.agentId === toAgentId);
    if (target === undefined) {
      throw new ValidationError('Chỉ giao được cho cấp dưới trực tiếp đang bật của người nhận.', {
        code: 'NOT_A_DIRECT_SUBORDINATE',
      });
    }
    this.taskHandover.handOverTask(task, target.agentId, 'manual');
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
