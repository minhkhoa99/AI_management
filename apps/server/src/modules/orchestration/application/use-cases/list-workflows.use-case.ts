import { Inject, Injectable } from '@nestjs/common';
import type { Workflow as WorkflowDto } from '@aiteam/contracts';
import { requireDepartment } from '../../../departments/application/use-cases/department-lookup';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { WorkflowPresenter } from './workflow-presenter';

@Injectable()
export class ListWorkflowsUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  listWorkflows(departmentId: string): WorkflowDto[] {
    requireDepartment(this.departmentRepository, departmentId);
    return this.workflowPresenter.presentWorkflows(
      departmentId,
      this.workflowRepository.listWorkflowsByDepartment(departmentId),
    );
  }
}
