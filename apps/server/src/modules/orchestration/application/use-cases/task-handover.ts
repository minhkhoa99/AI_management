import { Inject, Injectable } from '@nestjs/common';
import type { DelegationReason } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import type { Task } from '../../domain/entities/task';
import {
  TASK_DELEGATION_REPOSITORY,
  type TaskDelegationRepository,
} from '../../domain/repositories/task-delegation.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { listDirectSubordinates, type StaffMember } from '../../domain/step-assignee';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  type StaffDirectory,
  type TaskEventLog,
} from '../ports/task-execution.ports';
import { requireTaskExists } from './get-task-detail.use-case';
import { TaskRunRegistry } from './task-run-registry';

/**
 * Shared rules of "Giao xuống cấp dưới": only to the assignee's own direct subordinates that are
 * switched on, and never while a turn is running.
 */
@Injectable()
export class TaskHandover {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_DELEGATION_REPOSITORY)
    private readonly delegationRepository: TaskDelegationRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly runRegistry: TaskRunRegistry,
  ) {}

  requireDelegableTask(taskId: string): Task {
    const task = requireTaskExists(this.taskRepository, taskId);
    if (this.runRegistry.isRunning(taskId) || task.isFinished || task.status === 'cancelling') {
      throw new ConflictError('Chỉ giao lại được khi task không có agent đang chạy.', {
        code: 'TASK_BUSY',
      });
    }
    return task;
  }

  listDelegationTargets(task: Task): StaffMember[] {
    const assigneeId = task.assigneeAgentId;
    if (assigneeId === null) return [];
    return listDirectSubordinates(
      assigneeId,
      this.staffDirectory.listDepartmentStaff(task.departmentId),
    ).filter((member) => member.available);
  }

  handOverTask(task: Task, toAgentId: string, reason: DelegationReason): void {
    const fromAgentId = task.assigneeAgentId;
    task.assignTo(toAgentId);
    // A different agent starts its own engine session.
    task.forgetEngineSession(null);
    this.taskRepository.updateTask(task);
    this.delegationRepository.recordDelegation({
      id: this.idGenerator.generateId(),
      taskId: task.id,
      fromAgentId,
      toAgentId,
      reason,
    });
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: toAgentId,
      kind: 'delegated',
      payload: { reason },
    });
  }
}
