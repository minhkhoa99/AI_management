import { Inject, Injectable } from '@nestjs/common';
import type { ReplaceWorkflowStepsRequest, Workflow as WorkflowDto } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ConflictError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  WORKFLOW_TASK_USAGE,
  type WorkflowTaskUsage,
} from '../../domain/repositories/workflow-task-usage.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { requireWorkflow } from './workflow-lookup';
import { WorkflowPresenter } from './workflow-presenter';

/** Saves the whole chain at once ("Lưu quy trình"); a step with unfinished tasks cannot go. */
@Injectable()
export class ReplaceWorkflowStepsUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(WORKFLOW_TASK_USAGE) private readonly taskUsage: WorkflowTaskUsage,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  replaceWorkflowSteps(workflowId: string, request: ReplaceWorkflowStepsRequest): WorkflowDto {
    const workflow = this.transactionRunner.runInTransaction(() => {
      const target = requireWorkflow(this.workflowRepository, workflowId);
      const removedStepIds = target.replaceSteps(request.steps, this.idGenerator);
      const tasksOnRemovedSteps = this.taskUsage.countUnfinishedTasksOnSteps(removedStepIds);
      if (tasksOnRemovedSteps > 0) {
        throw new ConflictError(
          `Có ${tasksOnRemovedSteps} task chưa xong đang ở bước bị xoá. Giữ lại bước đó hoặc chờ task xong.`,
          { code: 'WORKFLOW_STEP_IN_USE' },
        );
      }
      this.workflowRepository.updateWorkflow(target);
      return target;
    });
    return this.workflowPresenter.presentWorkflow(workflow);
  }
}
