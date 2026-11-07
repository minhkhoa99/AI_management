import { Inject, Injectable } from '@nestjs/common';
import type { CreateTaskRequest, TaskDetail } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { requireDepartment } from '../../../departments/application/use-cases/department-lookup';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import { Task } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { GetTaskDetailUseCase } from './get-task-detail.use-case';
import { TaskPlacementPolicy } from './task-placement-policy';
import { WorkingDirectoryPolicy } from './working-directory-policy';

/** New task, queued for the scheduler. Disabled departments refuse new tasks. */
@Injectable()
export class CreateTaskUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly placementPolicy: TaskPlacementPolicy,
    private readonly workingDirectoryPolicy: WorkingDirectoryPolicy,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  async createTask(request: CreateTaskRequest): Promise<TaskDetail> {
    // Checked before the transaction: it reads the file system.
    const workingDirectory = await this.workingDirectoryPolicy.requireUsableWorkingDirectory(
      request.workingDirectory,
    );
    const taskId = this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, request.departmentId).assertAcceptsNewTasks();
      const task = Task.createNew({
        id: this.idGenerator.generateId(),
        sequenceNumber: this.taskRepository.allocateSequenceNumber(),
        departmentId: request.departmentId,
        workflowId: this.placementPolicy.resolveWorkflow(request.departmentId, request.workflowId),
        assigneeAgentId: this.placementPolicy.resolveAssignee(
          request.departmentId,
          request.assigneeAgentId,
        ),
        workingDirectory,
        title: request.title,
        description: request.description,
        criteria: request.criteria,
        priority: request.priority,
        testCommand: request.testCommand,
      });
      this.taskRepository.insertTask(task);
      return task.id;
    });
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }
}
