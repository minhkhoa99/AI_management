import type { Workflow } from '../entities/workflow';

export const WORKFLOW_REPOSITORY = Symbol('WORKFLOW_REPOSITORY');

export interface WorkflowRepository {
  /** Default first, then in creation order. */
  listWorkflowsByDepartment(departmentId: string): Workflow[];
  findWorkflowById(workflowId: string): Workflow | undefined;
  insertWorkflow(workflow: Workflow): void;
  /** Saves the header and synchronises the steps (kept, added, removed). */
  updateWorkflow(workflow: Workflow): void;
  deleteWorkflow(workflowId: string): void;
}
