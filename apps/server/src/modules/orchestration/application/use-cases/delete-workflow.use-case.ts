import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ConflictError } from '../../../../shared/errors/app-error';
import {
  WORKFLOW_TASK_USAGE,
  type WorkflowTaskUsage,
} from '../../domain/repositories/workflow-task-usage.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { requireWorkflow } from './workflow-lookup';

/**
 * Blocked for the department's last workflow and while unfinished tasks use it. Its finished
 * tasks move to the default workflow; deleting the default promotes the next one.
 */
@Injectable()
export class DeleteWorkflowUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(WORKFLOW_TASK_USAGE) private readonly taskUsage: WorkflowTaskUsage,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {}

  deleteWorkflow(workflowId: string): void {
    this.transactionRunner.runInTransaction(() => {
      const workflow = requireWorkflow(this.workflowRepository, workflowId);
      const remaining = this.workflowRepository
        .listWorkflowsByDepartment(workflow.departmentId)
        .filter((candidate) => candidate.id !== workflowId);
      const successor = remaining.find((candidate) => candidate.isDefault) ?? remaining[0];
      if (successor === undefined) {
        throw new ConflictError('Không xoá được quy trình cuối cùng của phòng.', {
          code: 'WORKFLOW_LAST_IN_DEPARTMENT',
        });
      }
      const unfinishedTasks = this.taskUsage.countUnfinishedTasksOfWorkflow(workflowId);
      if (unfinishedTasks > 0) {
        throw new ConflictError(
          `Còn ${unfinishedTasks} task chưa xong dùng quy trình này. Chờ task xong hoặc huỷ task trước.`,
          { code: 'WORKFLOW_IN_USE' },
        );
      }
      this.taskUsage.moveTasksToWorkflow(workflowId, successor.id);
      this.workflowRepository.deleteWorkflow(workflowId);
      if (!successor.isDefault) {
        successor.setDefault(true);
        this.workflowRepository.updateWorkflow(successor);
      }
    });
  }
}
