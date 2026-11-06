import { Inject, Injectable } from '@nestjs/common';
import type { UpdateWorkflowRulesRequest, Workflow as WorkflowDto } from '@aiteam/contracts';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { requireWorkflow } from './workflow-lookup';
import { WorkflowPresenter } from './workflow-presenter';

/** Enforcement and department-wide rules ("Luật chung"). */
@Injectable()
export class UpdateWorkflowRulesUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  updateWorkflowRules(workflowId: string, request: UpdateWorkflowRulesRequest): WorkflowDto {
    const workflow = requireWorkflow(this.workflowRepository, workflowId);
    workflow.changeRules({ enforce: request.enforce, rules: request.rules });
    this.workflowRepository.updateWorkflow(workflow);
    return this.workflowPresenter.presentWorkflow(workflow);
  }
}
