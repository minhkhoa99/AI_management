import { Inject, Injectable } from '@nestjs/common';
import { WORKFLOW_NAME_MAX_LENGTH, type Workflow as WorkflowDto } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { Workflow } from '../../domain/entities/workflow';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { requireWorkflow } from './workflow-lookup';
import { WorkflowPresenter } from './workflow-presenter';

/** Copies a workflow (steps, rules, enforcement) under a free "(bản sao)" name; never the default. */
@Injectable()
export class DuplicateWorkflowUseCase {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly workflowPresenter: WorkflowPresenter,
  ) {}

  duplicateWorkflow(workflowId: string): WorkflowDto {
    const copy = this.transactionRunner.runInTransaction(() => {
      const original = requireWorkflow(this.workflowRepository, workflowId);
      const originalState = original.toState();
      const siblings = this.workflowRepository.listWorkflowsByDepartment(original.departmentId);
      const duplicated = Workflow.createNew({
        id: this.idGenerator.generateId(),
        departmentId: original.departmentId,
        name: pickCopyName(original.name, (name) =>
          siblings.some((sibling) => sibling.hasSameNameAs(name)),
        ),
        description: originalState.description,
        isDefault: false,
        steps: original.copyStepBlueprints(),
        idGenerator: this.idGenerator,
      });
      duplicated.changeRules({ enforce: originalState.enforce, rules: originalState.rules });
      this.workflowRepository.insertWorkflow(duplicated);
      return duplicated;
    });
    return this.workflowPresenter.presentWorkflow(copy);
  }
}

function pickCopyName(originalName: string, isTaken: (name: string) => boolean): string {
  for (let copyNumber = 1; ; copyNumber += 1) {
    const suffix = copyNumber === 1 ? ' (bản sao)' : ` (bản sao ${copyNumber})`;
    const candidate =
      originalName.slice(0, WORKFLOW_NAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
}
