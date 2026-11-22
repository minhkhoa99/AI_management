import type { Workflow as WorkflowDto, WorkflowStepProblem } from '@aiteam/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors/app-error';
import type { DepartmentRepository } from '../../../departments/domain/repositories/department.repository';
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

/** Handoff steps must name an existing department (a 400 per step, not a foreign key 500). */
export function assertHandoffTargetsExist(
  departmentRepository: DepartmentRepository,
  steps: readonly { handoffDepartmentId: string | null }[],
): void {
  const problems: WorkflowStepProblem[] = [];
  steps.forEach((step, stepIndex) => {
    if (
      step.handoffDepartmentId !== null &&
      departmentRepository.findDepartmentById(step.handoffDepartmentId) === undefined
    ) {
      problems.push({ stepIndex, message: 'Phòng nhận bàn giao không tồn tại.' });
    }
  });
  const [first] = problems;
  if (first !== undefined) {
    throw new ValidationError(`Bước ${first.stepIndex + 1}: ${first.message}`, {
      code: 'WORKFLOW_HANDOFF_TARGET_NOT_FOUND',
      details: problems,
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
