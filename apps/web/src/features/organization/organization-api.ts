import {
  type AddDepartmentMemberRequest,
  agentDetailSchema,
  agentListSchema,
  bulkSetAgentsEnabledResponseSchema,
  type CreateDepartmentRequest,
  departmentListSchema,
  departmentSchema,
  departmentSummaryListSchema,
  orgTreeSchema,
  type UpdateDepartmentMemberRequest,
  type UpdateDepartmentRequest,
} from '@aiteam/contracts';
import { fetchApiJson, sendApiCommand, sendApiJson } from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

// Every write refreshes the mounted queries so sidebar, tables and tree stay in sync.
async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

const encodeId = encodeURIComponent;

export const loadDepartments = () => fetchApiJson('/api/departments', departmentListSchema);

export const loadDepartmentSummaries = () =>
  fetchApiJson('/api/departments/summary', departmentSummaryListSchema);

export const loadAgents = (departmentId?: string) =>
  fetchApiJson(
    departmentId === undefined
      ? '/api/agents'
      : `/api/agents?departmentId=${encodeId(departmentId)}`,
    agentListSchema,
  );

export const loadOrgTree = (departmentId: string) =>
  fetchApiJson(`/api/departments/${encodeId(departmentId)}/org-tree`, orgTreeSchema);

export const loadAgentDetail = (agentId: string) =>
  fetchApiJson(`/api/agents/${encodeId(agentId)}`, agentDetailSchema);

export const createDepartment = (request: CreateDepartmentRequest) =>
  refreshAfterWrite(sendApiJson('POST', '/api/departments', request, departmentSchema));

export const updateDepartment = (departmentId: string, request: UpdateDepartmentRequest) =>
  refreshAfterWrite(
    sendApiJson('PATCH', `/api/departments/${encodeId(departmentId)}`, request, departmentSchema),
  );

export const deleteDepartment = (departmentId: string) =>
  refreshAfterWrite(sendApiCommand('DELETE', `/api/departments/${encodeId(departmentId)}`));

export const setDepartmentEnabled = (departmentId: string, enabled: boolean) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/departments/${encodeId(departmentId)}/enabled`,
      { enabled },
      departmentSchema,
    ),
  );

export const addDepartmentMember = (departmentId: string, request: AddDepartmentMemberRequest) =>
  refreshAfterWrite(
    sendApiJson(
      'POST',
      `/api/departments/${encodeId(departmentId)}/members`,
      request,
      agentDetailSchema,
    ),
  );

export const updateDepartmentMember = (
  departmentId: string,
  positionId: string,
  request: UpdateDepartmentMemberRequest,
) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/departments/${encodeId(departmentId)}/members/${encodeId(positionId)}`,
      request,
      agentDetailSchema,
    ),
  );

export const changeReportingLine = (
  departmentId: string,
  positionId: string,
  reportsToPositionId: string,
) =>
  refreshAfterWrite(
    sendApiJson(
      'PUT',
      `/api/departments/${encodeId(departmentId)}/members/${encodeId(positionId)}/reports-to`,
      { reportsToPositionId },
      agentDetailSchema,
    ),
  );

export const removeDepartmentMember = (departmentId: string, positionId: string) =>
  refreshAfterWrite(
    sendApiCommand(
      'DELETE',
      `/api/departments/${encodeId(departmentId)}/members/${encodeId(positionId)}`,
    ),
  );

export const setAgentEnabled = (agentId: string, enabled: boolean) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/agents/${encodeId(agentId)}/enabled`,
      { enabled },
      agentDetailSchema,
    ),
  );

export const setAgentsEnabled = (agentIds: string[], enabled: boolean) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      '/api/agents/enabled',
      { agentIds, enabled },
      bulkSetAgentsEnabledResponseSchema,
    ),
  );
