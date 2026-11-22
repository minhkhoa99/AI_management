export const DEPARTMENT_WORKLOAD = Symbol('DEPARTMENT_WORKLOAD');

/** Tasks that tie a department or a member down (checked before deleting them). */
export interface DepartmentWorkload {
  countTasksOfDepartment(departmentId: string): number;
  /** Tasks of the agent that are not succeeded, failed or cancelled. */
  countUnfinishedTasksOfAgent(agentId: string): number;
  /** Workflow steps (of any department) that hand tasks off to this department. */
  countHandoffStepsTargeting(departmentId: string): number;
}
