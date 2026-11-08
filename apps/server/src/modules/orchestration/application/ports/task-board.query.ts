import type { TaskAgent, TaskSummary } from '@aiteam/contracts';

export const TASK_BOARD_QUERY = Symbol('TASK_BOARD_QUERY');

export interface TaskBoardFilter {
  departmentId?: string | undefined;
  workflowId?: string | undefined;
}

/** Read side of the task board: joined rows ready for the UI. */
export interface TaskBoardQuery {
  /** Highest priority first, then newest. */
  listTaskSummaries(filter: TaskBoardFilter): TaskSummary[];
  findTaskSummary(taskId: string): TaskSummary | undefined;
  /** Subtasks of a task, oldest first. */
  listSubtaskSummaries(parentTaskId: string): TaskSummary[];
  /** From the department head down to the agent. */
  listReportingChain(agentId: string): TaskAgent[];
  listDepartmentAgents(departmentId: string): TaskAgent[];
  /** Working folders of recent tasks, newest first. */
  listRecentWorkingDirectories(limit: number): string[];
}
