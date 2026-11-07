import { Inject, Injectable } from '@nestjs/common';
import type { Workflow as WorkflowDto } from '@aiteam/contracts';
import type { Workflow } from '../../domain/entities/workflow';
import {
  WORKFLOW_TASK_USAGE,
  type WorkflowTaskUsage,
} from '../../domain/repositories/workflow-task-usage.repository';
import { toWorkflowDto } from './workflow-lookup';

/** Turns workflows into DTOs with their task counts (one query per department). */
@Injectable()
export class WorkflowPresenter {
  constructor(@Inject(WORKFLOW_TASK_USAGE) private readonly taskUsage: WorkflowTaskUsage) {}

  presentWorkflows(departmentId: string, workflows: readonly Workflow[]): WorkflowDto[] {
    const taskCounts = this.taskUsage.countTasksPerWorkflow(departmentId);
    return workflows.map((workflow) => toWorkflowDto(workflow, taskCounts.get(workflow.id) ?? 0));
  }

  presentWorkflow(workflow: Workflow): WorkflowDto {
    const [dto] = this.presentWorkflows(workflow.departmentId, [workflow]);
    return dto ?? toWorkflowDto(workflow, 0);
  }
}
