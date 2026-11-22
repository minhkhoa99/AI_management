import type { WorkflowRunEvent } from '../../domain/workflow-run-stats';

export const WORKFLOW_RUN_HISTORY_QUERY = Symbol('WORKFLOW_RUN_HISTORY_QUERY');

export interface WorkflowRunHistory {
  /** Finished tasks read (at most the 100 most recent). */
  finishedTaskCount: number;
  /** Events relevant to step statistics, grouped by task, oldest first. */
  events: WorkflowRunEvent[];
}

/** Read side of a workflow's recent runs, for the AI optimization. */
export interface WorkflowRunHistoryQuery {
  listWorkflowRunHistory(workflowId: string): WorkflowRunHistory;
}
