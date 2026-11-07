import { Inject, Injectable } from '@nestjs/common';
import type { TaskDetail } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { leastBusy } from '../../domain/step-assignee';
import { STAFF_DIRECTORY, type StaffDirectory } from '../ports/task-execution.ports';
import { GetTaskDetailUseCase } from './get-task-detail.use-case';
import { TaskHandover } from './task-handover';
import { TaskProgression } from './task-progression';

/** "Để … tự giao": the least busy direct subordinate, preferring the current step's role. */
@Injectable()
export class AutoDelegateByWorkloadUseCase {
  constructor(
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    private readonly taskHandover: TaskHandover,
    private readonly progression: TaskProgression,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  autoDelegateTask(taskId: string): TaskDetail {
    const task = this.taskHandover.requireDelegableTask(taskId);
    const state = task.toState();
    const stepRole = this.progression
      .resolveTaskRoute(state.workflowId)
      ?.steps.find((step) => step.id === state.currentStepId)?.ownerRole;
    const targets = this.taskHandover.listDelegationTargets(task);
    const matching = targets.filter((member) => member.role === stepRole);
    const chosen = leastBusy(
      matching.length > 0 ? matching : targets,
      this.staffDirectory.countActiveTasksByAgent(state.departmentId),
    );
    if (chosen === undefined) {
      throw new ConflictError('Người nhận không có cấp dưới đang bật để giao.', {
        code: 'NO_SUBORDINATE_AVAILABLE',
      });
    }
    this.taskHandover.handOverTask(task, chosen.agentId, 'automatic');
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
