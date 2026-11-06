import {
  type ChangeAgentConfigurationRequest,
  agentDetailSchema,
  connectionCheckResultSchema,
  engineTestRunStartedSchema,
  type LocalEngine,
  localEngineSettingsSchema,
  localEngineStatusListSchema,
  type ModelDiscoveryRequest,
  modelDiscoveryResultSchema,
  providerConnectionListSchema,
  providerConnectionSchema,
  type SaveProviderConnectionRequest,
  type UpdateLocalEngineSettingsRequest,
} from '@aiteam/contracts';
import { fetchApiJson, sendApiCommand, sendApiJson } from '../../shared/api/api-client';
import { invalidateApiQueries } from '../../shared/api/use-api-query';

async function refreshAfterWrite<Result>(pendingWrite: Promise<Result>): Promise<Result> {
  const result = await pendingWrite;
  invalidateApiQueries();
  return result;
}

const encodeId = encodeURIComponent;

export const loadLocalEngines = () =>
  fetchApiJson('/api/local-engines', localEngineStatusListSchema);

export const updateLocalEngineSettings = (
  engine: LocalEngine,
  request: UpdateLocalEngineSettingsRequest,
) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/local-engines/${engine}/settings`,
      request,
      localEngineSettingsSchema,
    ),
  );

export const startLocalEngineTestRun = (engine: LocalEngine) =>
  sendApiJson(
    'POST',
    `/api/local-engines/${engine}/test-runs`,
    undefined,
    engineTestRunStartedSchema,
  );

export const cancelEngineTestRun = (testRunId: string) =>
  sendApiCommand('POST', `/api/engine-test-runs/${encodeId(testRunId)}/cancellation`);

export const loadProviderConnections = () =>
  fetchApiJson('/api/provider-connections', providerConnectionListSchema);

export const createProviderConnection = (request: SaveProviderConnectionRequest) =>
  refreshAfterWrite(
    sendApiJson('POST', '/api/provider-connections', request, providerConnectionSchema),
  );

export const updateProviderConnection = (
  connectionId: string,
  request: SaveProviderConnectionRequest,
) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/provider-connections/${encodeId(connectionId)}`,
      request,
      providerConnectionSchema,
    ),
  );

export const deleteProviderConnection = (connectionId: string) =>
  refreshAfterWrite(
    sendApiCommand('DELETE', `/api/provider-connections/${encodeId(connectionId)}`),
  );

export const discoverModels = (request: ModelDiscoveryRequest) =>
  sendApiJson(
    'POST',
    '/api/provider-connections/model-discovery',
    request,
    modelDiscoveryResultSchema,
  );

export const checkProviderConnection = (connectionId: string) =>
  sendApiJson(
    'POST',
    `/api/provider-connections/${encodeId(connectionId)}/checks`,
    undefined,
    connectionCheckResultSchema,
  );

export const startConnectionTestRun = (connectionId: string, model: string) =>
  sendApiJson(
    'POST',
    `/api/provider-connections/${encodeId(connectionId)}/test-runs`,
    { model },
    engineTestRunStartedSchema,
  );

export const changeAgentConfiguration = (
  agentId: string,
  request: ChangeAgentConfigurationRequest,
) =>
  refreshAfterWrite(
    sendApiJson(
      'PATCH',
      `/api/agents/${encodeId(agentId)}/configuration`,
      request,
      agentDetailSchema,
    ),
  );
