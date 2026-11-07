import {
  agentTileListSchema,
  checkpointListSchema,
  type SubmitCodeReviewRequest,
  lineCommentListSchema,
  lineCommentSchema,
  taskDetailSchema,
  taskEventListSchema,
  taskSummaryListSchema,
  workspaceDiffSchema,
  workspaceFileSchema,
  workspaceTreeSchema,
} from '@aiteam/contracts';
import { fetchApiJson, sendApiJson } from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

const encodeId = encodeURIComponent;

async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

export const loadAgentTiles = (departmentId?: string) =>
  fetchApiJson(
    departmentId === undefined
      ? '/api/monitor/agents'
      : `/api/monitor/agents?departmentId=${encodeId(departmentId)}`,
    agentTileListSchema,
  );

export const loadWorkspaceTree = (taskId: string) =>
  fetchApiJson(`/api/tasks/${encodeId(taskId)}/workspace/tree`, workspaceTreeSchema);

export const loadWorkspaceFile = (taskId: string, filePath: string) =>
  fetchApiJson(
    `/api/tasks/${encodeId(taskId)}/workspace/file?path=${encodeURIComponent(filePath)}`,
    workspaceFileSchema,
  );

export const loadCheckpoints = (taskId: string) =>
  fetchApiJson(`/api/tasks/${encodeId(taskId)}/checkpoints`, checkpointListSchema);

export const loadCheckpointDiff = (checkpointId: string) =>
  fetchApiJson(`/api/checkpoints/${encodeId(checkpointId)}/diff`, workspaceDiffSchema);

export const loadTaskDiff = (taskId: string) =>
  fetchApiJson(`/api/tasks/${encodeId(taskId)}/diff`, workspaceDiffSchema);

export const loadLineComments = (checkpointId: string) =>
  fetchApiJson(`/api/checkpoints/${encodeId(checkpointId)}/line-comments`, lineCommentListSchema);

export const addLineComment = (
  checkpointId: string,
  comment: { filePath: string; line: number; body: string },
) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/checkpoints/${encodeId(checkpointId)}/line-comments`,
      comment,
      lineCommentSchema,
    ),
  );

export const submitCodeReview = (taskId: string, review: SubmitCodeReviewRequest) =>
  refreshAfterWrite(
    sendApiJson('POST', `/api/tasks/${encodeId(taskId)}/reviews`, review, taskDetailSchema),
  );

export const revertWorkspaceFile = (taskId: string, filePath: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/tasks/${encodeId(taskId)}/workspace/file-reverts`,
      { path: filePath },
      checkpointListSchema,
    ),
  );

export const pauseTask = (taskId: string) =>
  refreshAfterWrite(
    sendApiJson('POST', `/api/tasks/${encodeId(taskId)}/pause`, undefined, taskDetailSchema),
  );

export const resumeTask = (taskId: string) =>
  refreshAfterWrite(
    sendApiJson('POST', `/api/tasks/${encodeId(taskId)}/resume`, undefined, taskDetailSchema),
  );

export const loadAgentEvents = (agentId: string) =>
  fetchApiJson(`/api/agents/${encodeId(agentId)}/events?limit=80`, taskEventListSchema);

export const loadDelegatedTasks = (agentId: string) =>
  fetchApiJson(`/api/agents/${encodeId(agentId)}/delegated-tasks`, taskSummaryListSchema);
