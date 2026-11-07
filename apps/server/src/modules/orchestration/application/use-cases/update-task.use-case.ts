import { Inject, Injectable } from '@nestjs/common';
import type { TaskDetail, UpdateTaskRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { GetTaskDetailUseCase, requireTaskExists } from './get-task-detail.use-case';
import { TaskPlacementPolicy } from './task-placement-policy';
import { WorkingDirectoryPolicy } from './working-directory-policy';

/** Edits a task; the workflow and the folder only change before work starts. */
@Injectable()
export class UpdateTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly placementPolicy: TaskPlacementPolicy,
    private readonly workingDirectoryPolicy: WorkingDirectoryPolicy,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  async updateTask(taskId: string, request: UpdateTaskRequest): Promise<TaskDetail> {
    const workingDirectory =
      request.workingDirectory === undefined
        ? undefined
        : await this.workingDirectoryPolicy.requireUsableWorkingDirectory(request.workingDirectory);
    this.transactionRunner.runInTransaction(() => {
      const task = requireTaskExists(this.taskRepository, taskId);
      task.editContent(request);
      if (request.assigneeAgentId !== undefined) {
        task.assignTo(
          this.placementPolicy.resolveAssignee(task.departmentId, request.assigneeAgentId),
        );
      }
      if (request.workflowId !== undefined) {
        task.changeWorkflow(
          this.placementPolicy.resolveWorkflow(task.departmentId, request.workflowId),
        );
      }
      if (workingDirectory !== undefined) {
        task.changeWorkingDirectory(workingDirectory);
      }
      this.taskRepository.updateTask(task);
    });
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
