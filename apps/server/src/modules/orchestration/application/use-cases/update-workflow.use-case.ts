import { Inject, Injectable } from '@nestjs/common';
import type { UpdateWorkflowRequest, Workflow as WorkflowDto } from '@aiteam/contracts';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { assertWorkflowNameIsFree, requireWorkflow } from './workflow-lookup';
import { WorkflowPresenter } from './workflow-presenter';

/** Renames a workflow and/or changes its description. */
@Injectable()
export class UpdateWorkflowUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  updateWorkflow(workflowId: string, request: UpdateWorkflowRequest): WorkflowDto {
    const workflow = requireWorkflow(this.workflowRepository, workflowId);
    if (request.name !== undefined) {
      workflow.rename(request.name);
      assertWorkflowNameIsFree(
        this.workflowRepository,
        workflow.departmentId,
        workflow.name,
        workflow.id,
      );
    }
    if (request.description !== undefined) {
      workflow.describe(request.description);
    }
    this.workflowRepository.updateWorkflow(workflow);
    return this.workflowPresenter.presentWorkflow(workflow);
  }
}
