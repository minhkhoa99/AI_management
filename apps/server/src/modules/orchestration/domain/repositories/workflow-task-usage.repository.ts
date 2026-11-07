export const WORKFLOW_TASK_USAGE = Symbol('WORKFLOW_TASK_USAGE');

/** How tasks use workflows: needed before removing a workflow or some of its steps. */
export interface WorkflowTaskUsage {
  /** Number of tasks per workflow id of the department (workflows without tasks are absent). */
  countTasksPerWorkflow(departmentId: string): Map<string, number>;
  /** Unfinished tasks (not succeeded, failed or cancelled) of a workflow. */
  countUnfinishedTasksOfWorkflow(workflowId: string): number;
  /** Unfinished tasks currently on one of these steps. */
  countUnfinishedTasksOnSteps(stepIds: readonly string[]): number;
  /** Moves every task of a workflow to another one; their current step is cleared. */
  moveTasksToWorkflow(fromWorkflowId: string, toWorkflowId: string): void;
}
