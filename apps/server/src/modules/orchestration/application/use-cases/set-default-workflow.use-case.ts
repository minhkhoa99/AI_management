import { Inject, Injectable } from '@nestjs/common';
import type { Workflow as WorkflowDto } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { WorkflowPresenter } from './workflow-presenter';

/** New tasks of the department use the default workflow unless another one is chosen. */
@Injectable()
export class SetDefaultWorkflowUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  setDefaultWorkflow(departmentId: string, workflowId: string): WorkflowDto {
    const chosen = this.transactionRunner.runInTransaction(() => {
      const workflows = this.workflowRepository.listWorkflowsByDepartment(departmentId);
      const target = workflows.find((workflow) => workflow.id === workflowId);
      if (target === undefined) {
        throw new NotFoundError('Không tìm thấy quy trình trong phòng này.', {
          code: 'WORKFLOW_NOT_FOUND',
        });
      }
      // Unset first: a partial unique index allows one default per department.
      for (const workflow of workflows) {
        if (workflow.isDefault && workflow.id !== workflowId) {
          workflow.setDefault(false);
          this.workflowRepository.updateWorkflow(workflow);
        }
      }
      target.setDefault(true);
      this.workflowRepository.updateWorkflow(target);
      return target;
    });
    return this.workflowPresenter.presentWorkflow(chosen);
  }
}
