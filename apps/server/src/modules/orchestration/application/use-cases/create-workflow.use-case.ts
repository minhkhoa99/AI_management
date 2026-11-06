import { Inject, Injectable } from '@nestjs/common';
import type { Workflow as WorkflowDto, WorkflowSource } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { requireDepartment } from '../../../departments/application/use-cases/department-lookup';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import { Workflow, type WorkflowStepBlueprint } from '../../domain/entities/workflow';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { BLANK_WORKFLOW_STEPS, findWorkflowTemplate } from '../../domain/workflow-templates';
import { assertWorkflowNameIsFree } from './workflow-lookup';
import { WorkflowPresenter } from './workflow-presenter';

/** New workflow from scratch, a template or a copy; the department's first one is the default. */
@Injectable()
export class CreateWorkflowUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  createWorkflow(
    departmentId: string,
    request: { name: string; description: string; source: WorkflowSource },
  ): WorkflowDto {
    const workflow = this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, departmentId);
      assertWorkflowNameIsFree(this.workflowRepository, departmentId, request.name);
      const created = Workflow.createNew({
        id: this.idGenerator.generateId(),
        departmentId,
        name: request.name,
        description: request.description,
        isDefault: this.workflowRepository.listWorkflowsByDepartment(departmentId).length === 0,
        steps: this.resolveStartingSteps(departmentId, request.source),
        idGenerator: this.idGenerator,
      });
      this.workflowRepository.insertWorkflow(created);
      return created;
    });
    return this.workflowPresenter.presentWorkflow(workflow);
  }

  private resolveStartingSteps(
    departmentId: string,
    source: WorkflowSource,
  ): readonly WorkflowStepBlueprint[] {
    switch (source.kind) {
      case 'blank':
        return BLANK_WORKFLOW_STEPS;
      case 'template':
        return findWorkflowTemplate(source.templateId).steps;
      case 'copy': {
        const original = this.workflowRepository.findWorkflowById(source.workflowId);
        if (original === undefined || original.departmentId !== departmentId) {
          throw new NotFoundError('Không tìm thấy quy trình để sao chép.', {
            code: 'WORKFLOW_NOT_FOUND',
          });
        }
        return original.copyStepBlueprints();
      }
    }
  }
}
