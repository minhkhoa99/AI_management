import {
  type CreateWorkflowRequest,
  type ReplaceWorkflowStepsRequest,
  type UpdateWorkflowRequest,
  type UpdateWorkflowRulesRequest,
  workflowListSchema,
  workflowSchema,
  workflowTemplateListSchema,
} from '@aiteam/contracts';
import { fetchApiJson, sendApiCommand, sendApiJson } from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

const encodeId = encodeURIComponent;

export const loadWorkflows = (departmentId: string) =>
  fetchApiJson(`/api/departments/${encodeId(departmentId)}/workflows`, workflowListSchema);

export const loadWorkflowTemplates = () =>
  fetchApiJson('/api/workflow-templates', workflowTemplateListSchema);

export const createWorkflow = (departmentId: string, request: CreateWorkflowRequest) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/departments/${encodeId(departmentId)}/workflows`,
      request,
      workflowSchema,
    ),
  );

export const updateWorkflow = (workflowId: string, request: UpdateWorkflowRequest) =>
  refreshAfterWrite(
    sendApiJson('PATCH', `/api/workflows/${encodeId(workflowId)}`, request, workflowSchema),
  );

export const duplicateWorkflow = (workflowId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/workflows/${encodeId(workflowId)}/duplicates`,
      undefined,
      workflowSchema,
    ),
  );

export const setDefaultWorkflow = (departmentId: string, workflowId: string) =>
  refreshAfterWrite(
    sendApiJson(
      'PUT',
      `/api/departments/${encodeId(departmentId)}/default-workflow`,
      { workflowId },
      workflowSchema,
    ),
  );

export const deleteWorkflow = (workflowId: string) =>
  refreshAfterWrite(sendApiCommand('DELETE', `/api/workflows/${encodeId(workflowId)}`));

export const replaceWorkflowSteps = (workflowId: string, request: ReplaceWorkflowStepsRequest) =>
  refreshAfterWrite(
    sendApiJson('PUT', `/api/workflows/${encodeId(workflowId)}/steps`, request, workflowSchema),
  );

export const updateWorkflowRules = (workflowId: string, request: UpdateWorkflowRulesRequest) =>
  refreshAfterWrite(
    sendApiJson('PATCH', `/api/workflows/${encodeId(workflowId)}/rules`, request, workflowSchema),
  );
