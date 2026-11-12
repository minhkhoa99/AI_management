import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  agentDetailSchema,
  apiErrorResponseSchema,
  connectionCheckResultSchema,
  departmentSchema,
  engineTestRunMessageSchema,
  localEngineModelListSchema,
  localEngineStatusListSchema,
  providerConnectionListSchema,
  providerConnectionSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineUnavailableError } from '../../shared/errors/app-error';
import { InProcessDomainEventBus } from '../../shared/events/in-process-domain-event-bus';
import {
  startTestApplication,
  TEST_LISTEN_PORT,
  TEST_SESSION_TOKEN,
  type TestApiResponse,
  type TestApplication,
} from '../../test-support/test-application';
import {
  AGENT_CONFIGURATION_CHANGED,
  type AgentConfigurationChanged,
} from '../agents/domain/events/agent-configuration-changed.event';

const FAKE_API_KEY = 'sk-fake-openai-key-0123456789';

let fakeApi: Server;
let fakeApiBaseUrl: string;
let fakeApiAuthorizations: Array<string | undefined>;
let app: TestApplication;

beforeEach(async () => {
  fakeApiAuthorizations = [];
  fakeApi = createServer((request, response) => {
    fakeApiAuthorizations.push(request.headers.authorization);
    if (request.headers.authorization !== `Bearer ${FAKE_API_KEY}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"bad key"}}');
      return;
    }
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":[{"id":"llama-3"},{"id":"qwen-2"}]}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      'data: {"id":"c1","choices":[{"delta":{"content":"Tôi hoạt động bình thường."}}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => fakeApi.listen(0, '127.0.0.1', resolve));
  fakeApiBaseUrl = `http://127.0.0.1:${(fakeApi.address() as AddressInfo).port}/v1`;
  app = await startTestApplication();
});

afterEach(async () => {
  await app.closeApplication();
  fakeApi.closeAllConnections();
  await new Promise<void>((resolve) => fakeApi.close(() => resolve()));
});

function readErrorCode(response: TestApiResponse): string {
  return apiErrorResponseSchema.parse(response.body).error.code;
}

async function createConnection(overrides: Record<string, unknown> = {}) {
  const response = await app.callApi('POST', '/api/provider-connections', {
    name: 'Ollama máy nhà',
    format: 'openai',
    baseUrl: fakeApiBaseUrl,
    apiKey: FAKE_API_KEY,
    models: ['llama-3'],
    defaultModel: 'llama-3',
    ...overrides,
  });
  expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
  return providerConnectionSchema.parse(response.body);
}

async function createAgent(provider: 'codex' | 'claude_code' | 'antigravity' = 'codex') {
  const department = departmentSchema.parse(
    (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
  );
  return agentDetailSchema.parse(
    (
      await app.callApi('POST', `/api/departments/${department.id}/members`, {
        name: 'Dev backend',
        role: 'dev',
        provider,
        reportsToPositionId: null,
      })
    ).body,
  );
}

describe('provider connections', () => {
  it('stores the key encrypted and only ever returns its last 4 characters', async () => {
    const connection = await createConnection();

    expect(connection).toMatchObject({ keyHint: '6789', models: ['llama-3'], agentNames: [] });
    const listed = providerConnectionListSchema.parse(
      (await app.callApi('GET', '/api/provider-connections')).body,
    );
    expect(JSON.stringify(listed)).not.toContain(FAKE_API_KEY);
    const stored = app.database.prepare('SELECT encrypted_key FROM provider_connections').get() as {
      encrypted_key: string;
    };
    expect(stored.encrypted_key).toMatch(/^v1:/);
    expect(stored.encrypted_key).not.toContain(FAKE_API_KEY);
  });

  it('discovers models with a typed key and with the stored key', async () => {
    const typed = await app.callApi('POST', '/api/provider-connections/model-discovery', {
      format: 'openai',
      baseUrl: fakeApiBaseUrl,
      apiKey: FAKE_API_KEY,
    });
    expect(typed.body).toEqual({ models: ['llama-3', 'qwen-2'] });

    const connection = await createConnection();
    const stored = await app.callApi('POST', '/api/provider-connections/model-discovery', {
      format: 'openai',
      baseUrl: fakeApiBaseUrl,
      connectionId: connection.id,
    });
    expect(stored.body).toEqual({ models: ['llama-3', 'qwen-2'] });
  });

  it('never sends a stored key to a different host', async () => {
    const connection = await createConnection();

    const response = await app.callApi('POST', '/api/provider-connections/model-discovery', {
      format: 'openai',
      baseUrl: 'http://localhost:1/v1',
      connectionId: connection.id,
    });

    expect(response.statusCode).toBe(503);
    expect(fakeApiAuthorizations).toEqual([]);
  });

  it('requires the key again when the host changes, keeps it otherwise', async () => {
    const connection = await createConnection();
    const update = {
      name: 'Đổi tên',
      format: 'openai',
      models: ['llama-3', 'qwen-2'],
      defaultModel: 'qwen-2',
    };

    const sameHost = await app.callApi('PATCH', `/api/provider-connections/${connection.id}`, {
      ...update,
      baseUrl: fakeApiBaseUrl,
    });
    expect(providerConnectionSchema.parse(sameHost.body)).toMatchObject({
      name: 'Đổi tên',
      keyHint: '6789',
    });

    const newHost = await app.callApi('PATCH', `/api/provider-connections/${connection.id}`, {
      ...update,
      baseUrl: 'https://api.example.com/v1',
    });
    expect(readErrorCode(newHost)).toBe('API_KEY_REQUIRED_FOR_NEW_HOST');
  });

  it.each([
    ['plain http to a remote host', { baseUrl: 'http://api.example.com/v1' }],
    ['credentials inside the URL', { baseUrl: 'https://user:pass@api.example.com' }],
    ['a default model outside the list', { defaultModel: 'gpt-x' }],
    ['a model name looking like a CLI flag', { models: ['--danger'], defaultModel: null }],
  ])('rejects %s', async (_label, overrides) => {
    const response = await app.callApi('POST', '/api/provider-connections', {
      name: 'X',
      format: 'openai',
      baseUrl: fakeApiBaseUrl,
      models: ['llama-3'],
      defaultModel: 'llama-3',
      ...overrides,
    });

    expect(response.statusCode).toBe(400);
  });

  it('checks a connection: reachable, and unreachable with a wrong key', async () => {
    const good = await createConnection();
    const bad = await createConnection({ apiKey: 'sk-wrong-key-0000000000' });

    const goodCheck = connectionCheckResultSchema.parse(
      (await app.callApi('POST', `/api/provider-connections/${good.id}/checks`)).body,
    );
    const badCheck = connectionCheckResultSchema.parse(
      (await app.callApi('POST', `/api/provider-connections/${bad.id}/checks`)).body,
    );

    expect(goodCheck).toMatchObject({ reachable: true, modelCount: 2 });
    expect(badCheck).toMatchObject({
      reachable: false,
      modelCount: null,
      message: expect.stringContaining('401'),
    });
  });

  it('streams a real test run through the connection over SSE', async () => {
    const connection = await createConnection();

    const started = await app.callApi(
      'POST',
      `/api/provider-connections/${connection.id}/test-runs`,
      { model: 'llama-3' },
    );
    expect(started.statusCode).toBe(201);
    const { testRunId } = started.body as { testRunId: string };

    const stream = await app.application.inject({
      method: 'GET',
      url: `/api/engine-test-runs/${testRunId}/events`,
      headers: {
        host: `127.0.0.1:${TEST_LISTEN_PORT}`,
        cookie: `aiteam_session=${TEST_SESSION_TOKEN}`,
      },
    });

    expect(stream.headers['content-type']).toContain('text/event-stream');
    const messages = stream.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => engineTestRunMessageSchema.parse(JSON.parse(line.slice(6))));
    expect(messages.map((message) => message.event.kind)).toEqual([
      'session_started',
      'text_delta',
      'message',
      'completed',
    ]);
    expect(stream.body).not.toContain(FAKE_API_KEY);
  });

  it('rejects a test run with a model the connection does not list', async () => {
    const connection = await createConnection();

    const response = await app.callApi(
      'POST',
      `/api/provider-connections/${connection.id}/test-runs`,
      { model: 'qwen-2' },
    );

    expect(readErrorCode(response)).toBe('MODEL_NOT_LISTED');
  });

  it('blocks deleting a connection used by an agent', async () => {
    const connection = await createConnection();
    const agent = await createAgent();
    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      provider: 'custom_api',
      connectionId: connection.id,
      model: 'llama-3',
    });

    const blocked = await app.callApi('DELETE', `/api/provider-connections/${connection.id}`);
    expect(readErrorCode(blocked)).toBe('CONNECTION_IN_USE');

    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, { provider: 'codex' });
    expect(
      (await app.callApi('DELETE', `/api/provider-connections/${connection.id}`)).statusCode,
    ).toBe(204);
  });
});

describe('Antigravity agents', () => {
  it('creates an agent on the Antigravity engine', async () => {
    const agent = await createAgent('antigravity');

    expect(agent.provider).toBe('antigravity');
  });

  it('rejects a connection on an Antigravity agent, at creation', async () => {
    const connection = await createConnection();
    const department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );

    const response = await app.callApi('POST', `/api/departments/${department.id}/members`, {
      name: 'Dev backend',
      role: 'dev',
      provider: 'antigravity',
      connectionId: connection.id,
      reportsToPositionId: null,
    });

    expect(readErrorCode(response)).toBe('CONNECTION_NOT_APPLICABLE');
  });
});

describe('agent configuration changes', () => {
  function captureConfigurationEvents(): AgentConfigurationChanged[] {
    const captured: AgentConfigurationChanged[] = [];
    app.application
      .get(InProcessDomainEventBus)
      .subscribeToDomainEvent<AgentConfigurationChanged>(AGENT_CONFIGURATION_CHANGED, (event) =>
        captured.push(event),
      );
    return captured;
  }

  it('switches brain to Custom API and publishes the change', async () => {
    const connection = await createConnection();
    const agent = await createAgent('codex');
    const events = captureConfigurationEvents();

    const response = await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      provider: 'custom_api',
      connectionId: connection.id,
      model: 'llama-3',
    });

    expect(agentDetailSchema.parse(response.body)).toMatchObject({
      provider: 'custom_api',
      connectionId: connection.id,
      model: 'llama-3',
    });
    expect(events).toEqual([
      {
        type: 'AgentConfigurationChanged',
        agentId: agent.id,
        changes: [
          { field: 'provider', from: 'codex', to: 'custom_api' },
          { field: 'connectionId', from: null, to: connection.id },
          { field: 'model', from: null, to: 'llama-3' },
        ],
        reducesPermissions: false,
      },
    ]);
  });

  it('flags permission reductions, including turning the agent off', async () => {
    const agent = await createAgent();
    const events = captureConfigurationEvents();

    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      accessLevel: 'edit_workspace',
      networkAccess: true,
    });
    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, { networkAccess: false });
    await app.callApi('PATCH', `/api/agents/${agent.id}/enabled`, { enabled: false });
    await app.callApi('PATCH', '/api/agents/enabled', { agentIds: [agent.id], enabled: true });

    expect(events.map((event) => event.reducesPermissions)).toEqual([false, true, true, false]);
  });

  it('publishes nothing when the configuration does not change', async () => {
    const agent = await createAgent();
    const events = captureConfigurationEvents();

    await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      provider: 'codex',
      accessLevel: 'read_only',
    });

    expect(events).toEqual([]);
  });

  it('rejects an unknown connection and keeps the old brain', async () => {
    const agent = await createAgent();

    const response = await app.callApi('PATCH', `/api/agents/${agent.id}/configuration`, {
      provider: 'custom_api',
      connectionId: 'missing-connection',
      model: 'llama-3',
    });

    expect(readErrorCode(response)).toBe('CONNECTION_NOT_FOUND');
    expect(
      agentDetailSchema.parse((await app.callApi('GET', `/api/agents/${agent.id}`)).body).provider,
    ).toBe('codex');
  });
});

describe('local engines', () => {
  it('lists every engine with their safe default settings', async () => {
    const engines = localEngineStatusListSchema.parse(
      (await app.callApi('GET', '/api/local-engines')).body,
    );

    expect(engines.map((engine) => engine.engine)).toEqual(['claude_code', 'codex', 'antigravity']);
    expect(
      engines.every(
        (engine) => engine.settings.blockDangerousCommands && !engine.settings.allowNetwork,
      ),
    ).toBe(true);
  });

  it('saves the settings of the Antigravity engine', async () => {
    const updated = await app.callApi('PATCH', '/api/local-engines/antigravity/settings', {
      defaultModel: 'agy-flash',
      allowNetwork: true,
    });

    expect(updated.body).toEqual({
      defaultModel: 'agy-flash',
      blockDangerousCommands: true,
      allowNetwork: true,
    });
  });

  it('updates settings and validates the model name', async () => {
    const updated = await app.callApi('PATCH', '/api/local-engines/claude_code/settings', {
      defaultModel: 'claude-haiku-5-5',
      allowNetwork: true,
    });
    expect(updated.body).toEqual({
      defaultModel: 'claude-haiku-5-5',
      blockDangerousCommands: true,
      allowNetwork: true,
    });

    const flag = await app.callApi('PATCH', '/api/local-engines/codex/settings', {
      defaultModel: '--yolo',
    });
    expect(flag.statusCode).toBe(400);
    const unknownEngine = await app.callApi('PATCH', '/api/local-engines/gemini/settings', {
      allowNetwork: true,
    });
    expect(unknownEngine.statusCode).toBe(400);
  });

  it('offers model quick picks: Claude aliases and the catalogs of Codex and Antigravity', async () => {
    const catalogApp = await startTestApplication(undefined, {
      localEngineAdaptersOverride: {
        codexModelCatalog: {
          listCodexModels: () =>
            Promise.resolve([{ model: 'gpt-fake', label: 'GPT Fake', note: 'from the fake' }]),
        },
        antigravityModelCatalog: {
          listAntigravityModels: () =>
            Promise.resolve([{ model: 'agy-fake', label: 'Agy Fake', note: 'from the fake' }]),
        },
      },
    });
    try {
      const claude = localEngineModelListSchema.parse(
        (await catalogApp.callApi('GET', '/api/local-engines/claude_code/models')).body,
      );
      expect(claude.models.map((choice) => choice.model)).toEqual([
        'opus',
        'sonnet',
        'haiku',
        'fable',
      ]);

      const codex = await catalogApp.callApi('GET', '/api/local-engines/codex/models');
      expect(codex.statusCode).toBe(200);
      expect(localEngineModelListSchema.parse(codex.body).models.map((m) => m.model)).toEqual([
        'gpt-fake',
      ]);

      const antigravity = await catalogApp.callApi('GET', '/api/local-engines/antigravity/models');
      expect(antigravity.statusCode).toBe(200);
      expect(localEngineModelListSchema.parse(antigravity.body).models.map((m) => m.model)).toEqual(
        ['agy-fake'],
      );

      const unknownEngine = await catalogApp.callApi('GET', '/api/local-engines/gemini/models');
      expect(unknownEngine.statusCode).toBe(400);
    } finally {
      await catalogApp.closeApplication();
    }
  });

  it('answers an empty model list with a problem, never an error, when a catalog fails', async () => {
    const failingApp = await startTestApplication(undefined, {
      localEngineAdaptersOverride: {
        codexModelCatalog: {
          listCodexModels: () => Promise.reject(new EngineUnavailableError('Codex CLI is missing')),
        },
        antigravityModelCatalog: {
          listAntigravityModels: () =>
            Promise.reject(new EngineUnavailableError('agy CLI is missing')),
        },
      },
    });
    try {
      for (const [engine, problem] of [
        ['codex', 'Codex CLI is missing'],
        ['antigravity', 'agy CLI is missing'],
      ] as const) {
        const response = await failingApp.callApi('GET', `/api/local-engines/${engine}/models`);
        expect(response.statusCode).toBe(200);
        expect(localEngineModelListSchema.parse(response.body)).toEqual({ models: [], problem });
      }
    } finally {
      await failingApp.closeApplication();
    }
  });

  it('answers 404 for an unknown test run stream', async () => {
    const response = await app.callApi('GET', '/api/engine-test-runs/unknown-run/events');

    expect(readErrorCode(response)).toBe('TEST_RUN_NOT_FOUND');
  });
});
