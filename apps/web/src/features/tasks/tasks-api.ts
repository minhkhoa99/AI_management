import {
  approvalListSchema,
  approvalSchema,
  type CreateTaskRequest,
  directoryPickSchema,
  directoryValidationSchema,
  recentDirectoryListSchema,
  taskAttachmentSchema,
  taskDeletionSchema,
  taskDetailSchema,
  taskEventListSchema,
  taskSummaryListSchema,
  type UpdateTaskRequest,
  type UpdateWorkspaceSettingsRequest,
  workspaceSettingsSchema,
} from '@aiteam/contracts';
import {
  fetchApiJson,
  sendApiBytes,
  sendApiCommand,
  sendApiJson,
} from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

const encodeId = encodeURIComponent;

// ---- Tasks ----------------------------------------------------------------------------------

export const loadTasks = (departmentId?: string) =>
  fetchApiJson(
    departmentId === undefined ? '/api/tasks' : `/api/tasks?departmentId=${encodeId(departmentId)}`,
    taskSummaryListSchema,
  );

export const loadTaskDetail = (taskId: string) =>
  fetchApiJson(`/api/tasks/${encodeId(taskId)}`, taskDetailSchema);

/** Not refreshed here: the form uploads QA documents next, then refreshes once. */
export const createTask = (request: CreateTaskRequest) =>
  sendApiJson('POST', '/api/tasks', request, taskDetailSchema);

export const updateTask = (taskId: string, request: UpdateTaskRequest) =>
  sendApiJson('PATCH', `/api/tasks/${encodeId(taskId)}`, request, taskDetailSchema);

export const deleteTask = (taskId: string) =>
  refreshAfterWrite(
    sendApiJson('DELETE', `/api/tasks/${encodeId(taskId)}`, undefined, taskDeletionSchema),
  );

export const uploadQaDocument = (taskId: string, file: File) =>
  sendApiBytes(
    'PUT',
    `/api/tasks/${encodeId(taskId)}/attachments?fileName=${encodeURIComponent(file.name)}`,
    file,
    taskAttachmentSchema,
  );

export const removeQaDocument = (taskId: string, attachmentId: string) =>
  sendApiCommand('DELETE', `/api/tasks/${encodeId(taskId)}/attachments/${encodeId(attachmentId)}`);

// ---- Workspace ------------------------------------------------------------------------------

export const loadWorkspaceSettings = () => fetchApiJson('/api/settings', workspaceSettingsSchema);

export const updateWorkspaceSettings = (request: UpdateWorkspaceSettingsRequest) =>
  refreshAfterWrite(sendApiJson('PATCH', '/api/settings', request, workspaceSettingsSchema));

/** Opens the folder dialog on this machine; a picked folder becomes allowed. */
export const pickLocalDirectory = () =>
  refreshAfterWrite(
    sendApiJson('POST', '/api/workspace/dir-picker', undefined, directoryPickSchema),
  );

export const validateWorkingDirectory = (directoryPath: string) =>
  sendApiJson(
    'POST',
    '/api/workspace/dir-validation',
    { path: directoryPath },
    directoryValidationSchema,
  );

export const loadRecentDirectories = () =>
  fetchApiJson('/api/workspace/recent-dirs', recentDirectoryListSchema);

// ---- Execution ------------------------------------------------------------------------------

export const delegateTask = (taskId: string, toAgentId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/tasks/${encodeId(taskId)}/delegations`,
      { toAgentId },
      taskDetailSchema,
    ),
  );

export const autoDelegateTask = (taskId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/tasks/${encodeId(taskId)}/auto-delegations`,
      undefined,
      taskDetailSchema,
    ),
  );

export const moveTaskStage = (taskId: string, direction: 'back' | 'forward') =>
  refreshAfterWrite(
    sendApiJson('PATCH', `/api/tasks/${encodeId(taskId)}/stage`, { direction }, taskDetailSchema),
  );

export const retryTask = (taskId: string) =>
  refreshAfterWrite(
    sendApiJson('POST', `/api/tasks/${encodeId(taskId)}/retries`, undefined, taskDetailSchema),
  );

export const loadTaskEvents = (taskId: string, limit = 40) =>
  fetchApiJson(`/api/tasks/${encodeId(taskId)}/events?limit=${limit}`, taskEventListSchema);

export const loadPendingApprovals = () =>
  fetchApiJson('/api/approvals?status=pending', approvalListSchema);

export const decideApproval = (approvalId: string, approved: boolean, note: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/approvals/${encodeId(approvalId)}/decision`,
      { approved, note },
      approvalSchema,
    ),
  );
