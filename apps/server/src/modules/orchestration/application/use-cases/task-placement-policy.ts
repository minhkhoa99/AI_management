import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../../../shared/errors/app-error';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../../departments/domain/repositories/position.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';

/** Who receives a task and which workflow it follows, always inside the task's department. */
@Injectable()
export class TaskPlacementPolicy {
  constructor(
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
  ) {}

  /** The requested member of the department, or its head when none is requested. */
  resolveAssignee(departmentId: string, requestedAgentId: string | undefined): string {
    const positions = this.positionRepository.listPositionsByDepartment(departmentId);
    if (positions.length === 0) {
      throw new ValidationError('Phòng chưa có thành viên để nhận task.', {
        code: 'DEPARTMENT_HAS_NO_MEMBERS',
      });
    }
    if (requestedAgentId === undefined) {
      const head = positions.find((position) => position.reportsToPositionId === null);
      return (head ?? positions[0])?.agentId ?? '';
    }
    if (!positions.some((position) => position.agentId === requestedAgentId)) {
      throw new ValidationError('Người nhận phải là thành viên của phòng.', {
        code: 'ASSIGNEE_NOT_IN_DEPARTMENT',
      });
    }
    return requestedAgentId;
  }

  /** undefined → the department's default workflow (if any); null → no workflow. */
  resolveWorkflow(
    departmentId: string,
    requestedWorkflowId: string | null | undefined,
  ): string | null {
    if (requestedWorkflowId === null) {
      return null;
    }
    const workflows = this.workflowRepository.listWorkflowsByDepartment(departmentId);
    if (requestedWorkflowId === undefined) {
      return workflows.find((workflow) => workflow.isDefault)?.id ?? null;
    }
    if (!workflows.some((workflow) => workflow.id === requestedWorkflowId)) {
      throw new NotFoundError('Không tìm thấy quy trình trong phòng này.', {
        code: 'WORKFLOW_NOT_FOUND',
      });
    }
    return requestedWorkflowId;
  }
}
