import type { Workflow as WorkflowDto } from '@aiteam/contracts';
import { ConflictError, NotFoundError } from '../../../../shared/errors/app-error';
import type { Workflow } from '../../domain/entities/workflow';
import type { WorkflowRepository } from '../../domain/repositories/workflow.repository';

export function requireWorkflow(
  workflowRepository: WorkflowRepository,
  workflowId: string,
): Workflow {
  const workflow = workflowRepository.findWorkflowById(workflowId);
  if (workflow === undefined) {
    throw new NotFoundError('Không tìm thấy quy trình.', { code: 'WORKFLOW_NOT_FOUND' });
  }
  return workflow;
}

/** Names are unique inside a department, ignoring case. */
export function assertWorkflowNameIsFree(
  workflowRepository: WorkflowRepository,
  departmentId: string,
  name: string,
  ignoredWorkflowId?: string,
): void {
  const clash = workflowRepository
    .listWorkflowsByDepartment(departmentId)
    .find((workflow) => workflow.id !== ignoredWorkflowId && workflow.hasSameNameAs(name));
  if (clash !== undefined) {
    throw new ConflictError(`Phòng đã có quy trình "${clash.name}".`, {
      code: 'WORKFLOW_NAME_TAKEN',
    });
  }
}

export function toWorkflowDto(workflow: Workflow, taskCount: number): WorkflowDto {
  const state = workflow.toState();
  return {
    id: state.id,
    departmentId: state.departmentId,
    name: state.name,
    description: state.description,
    isDefault: state.isDefault,
    enforce: state.enforce,
    rules: state.rules,
    steps: state.steps.map((step) => ({ ...step })),
    taskCount,
  };
}
