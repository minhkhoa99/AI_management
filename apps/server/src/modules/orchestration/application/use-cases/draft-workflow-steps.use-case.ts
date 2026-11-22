import { Inject, Injectable } from '@nestjs/common';
import type { DraftWorkflowStepsRequest, WorkflowProposal } from '@aiteam/contracts';
import { requireDepartment } from '../../../departments/application/use-cases/department-lookup';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import { WorkflowProposalAuthor } from './workflow-proposal-author';

/** AI drafts a new workflow from the user's goal; nothing is saved. */
@Injectable()
export class DraftWorkflowStepsUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    private readonly proposalAuthor: WorkflowProposalAuthor,
  ) {}

  async draftWorkflowSteps(
    departmentId: string,
    request: DraftWorkflowStepsRequest,
  ): Promise<WorkflowProposal> {
    const department = requireDepartment(this.departmentRepository, departmentId);
    const proposal = await this.proposalAuthor.writeWorkflowProposal({
      departmentId,
      departmentName: department.name,
      agentId: request.agentId,
      mode: { kind: 'draft', goal: request.goal },
    });
    return { ...proposal, basedOnTaskCount: 0 };
  }
}
