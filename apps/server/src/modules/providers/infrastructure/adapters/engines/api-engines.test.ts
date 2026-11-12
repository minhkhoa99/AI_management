import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSessionRequest } from '../../../../orchestration/application/ports/agent-engine.port';
import { AnthropicApiEngine } from './anthropic-api.engine';
import { OpenAiCompatibleEngine } from './openai-compatible.engine';

type RouteHandler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let routeHandler: RouteHandler;
let receivedRequests: Array<{
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}>;

beforeEach(async () => {
  receivedRequests = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      receivedRequests.push({
        url: request.url ?? '',
        headers: request.headers,
        body: JSON.parse(body || '{}'),
      });
      routeHandler(request, body, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sendEventStream(response: ServerResponse, frames: string[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const frame of frames) {
    response.write(frame);
  }
  response.end();
}

function buildRequest(format: 'openai' | 'anthropic', apiBaseUrl: string): AgentSessionRequest {
  return {
    prompt: 'Chào',
    workingDirectory: '.',
    workspaceRoot: null,
    model: 'test-model',
    permissions: { accessLevel: 'read_only', networkAccess: false, blockDangerousCommands: true },
    resumeSessionRef: null,
    apiConnection: { format, baseUrl: apiBaseUrl, apiKey: 'sk-test-1234567890' },
  };
}

async function collectEvents(events: AsyncIterable<AgentEngineEvent>): Promise<AgentEngineEvent[]> {
  const collected: AgentEngineEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('AnthropicApiEngine', () => {
  it('streams text deltas and reports usage, sending the documented headers and no sampling fields', async () => {
    routeHandler = (_request, _body, response) =>
      sendEventStream(response, [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"test-model","usage":{"input_tokens":11}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Xin "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"chào"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);

    const events = await collectEvents(
      new AnthropicApiEngine().startSession(
        buildRequest('anthropic', baseUrl),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { kind: 'session_started', sessionRef: 'msg_1', model: 'test-model' },
      { kind: 'text_delta', text: 'Xin ' },
      { kind: 'text_delta', text: 'chào' },
      { kind: 'message', text: 'Xin chào' },
      { kind: 'usage', inputTokens: 11, outputTokens: 3, costUsd: null },
      { kind: 'completed', summary: 'Xin chào' },
    ]);
    const [sent] = receivedRequests;
    expect(sent?.url).toBe('/v1/messages');
    expect(sent?.headers['x-api-key']).toBe('sk-test-1234567890');
    expect(sent?.headers['anthropic-version']).toBe('2026-10-21');
    expect(sent?.body).toMatchObject({ model: 'test-model', stream: true, max_tokens: 16000 });
    expect(sent?.body).not.toHaveProperty('temperature');
  });

  it('accepts a base URL that already ends with /v1', async () => {
    routeHandler = (_request, _body, response) =>
      sendEventStream(response, ['event: message_stop\ndata: {"type":"message_stop"}\n\n']);

    await collectEvents(
      new AnthropicApiEngine().startSession(
        buildRequest('anthropic', `${baseUrl}/v1`),
        new AbortController().signal,
      ),
    );

    expect(receivedRequests[0]?.url).toBe('/v1/messages');
  });

  it('reports a refusal as a non-retryable failure', async () => {
    routeHandler = (_request, _body, response) =>
      sendEventStream(response, [
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}\n\n',
      ]);

    const events = await collectEvents(
      new AnthropicApiEngine().startSession(
        buildRequest('anthropic', baseUrl),
        new AbortController().signal,
      ),
    );

    expect(events.at(-1)).toMatchObject({ kind: 'failed', code: 'REFUSED', retryable: false });
  });

  it('turns an overloaded error inside the stream into a retryable failure', async () => {
    routeHandler = (_request, _body, response) =>
      sendEventStream(response, [
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ]);

    const events = await collectEvents(
      new AnthropicApiEngine().startSession(
        buildRequest('anthropic', baseUrl),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { kind: 'failed', code: 'ENGINE_REPORTED_ERROR', message: 'Overloaded', retryable: true },
    ]);
  });
});

describe('OpenAiCompatibleEngine', () => {
  it('streams chat completion chunks until [DONE] with a bearer token', async () => {
    routeHandler = (_request, _body, response) =>
      sendEventStream(response, [
        'data: {"id":"c1","model":"test-model","choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"id":"c1","choices":[{"delta":{"content":"Xin "}}]}\n\n',
        'data: {"id":"c1","choices":[{"delta":{"content":"chào"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ]);

    const events = await collectEvents(
      new OpenAiCompatibleEngine().startSession(
        buildRequest('openai', baseUrl),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { kind: 'session_started', sessionRef: 'c1', model: 'test-model' },
      { kind: 'text_delta', text: 'Xin ' },
      { kind: 'text_delta', text: 'chào' },
      { kind: 'message', text: 'Xin chào' },
      { kind: 'usage', inputTokens: 9, outputTokens: 2, costUsd: null },
      { kind: 'completed', summary: 'Xin chào' },
    ]);
    expect(receivedRequests[0]?.url).toBe('/chat/completions');
    expect(receivedRequests[0]?.headers.authorization).toBe('Bearer sk-test-1234567890');
  });

  it.each([
    [401, 'ENGINE_AUTH_FAILED', false],
    [429, 'RATE_LIMITED', true],
    [503, 'ENGINE_UNAVAILABLE', true],
    [400, 'API_REQUEST_REJECTED', false],
  ])(
    'maps HTTP %s to %s (retryable=%s) without leaking the key',
    async (status, code, retryable) => {
      routeHandler = (_request, _body, response) => {
        response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '7' });
        response.end(JSON.stringify({ error: { message: `upstream says ${status}` } }));
      };

      const events = await collectEvents(
        new OpenAiCompatibleEngine().startSession(
          buildRequest('openai', baseUrl),
          new AbortController().signal,
        ),
      );

      expect(events).toEqual([
        {
          kind: 'failed',
          code,
          message: expect.stringContaining(`upstream says ${status}`),
          retryable,
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('sk-test');
    },
  );

  it('reports an unreachable server as retryable', async () => {
    const events = await collectEvents(
      new OpenAiCompatibleEngine().startSession(
        buildRequest('openai', 'http://127.0.0.1:1'),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      expect.objectContaining({ kind: 'failed', code: 'ENGINE_UNAVAILABLE', retryable: true }),
    ]);
  });

  it('ends with cancelled when aborted mid-stream', async () => {
    routeHandler = (_request, _body, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"id":"c1","choices":[{"delta":{"content":"Đang viết"}}]}\n\n');
      // Never ends: only the abort can stop the session.
    };
    const abortController = new AbortController();
    const events: AgentEngineEvent[] = [];

    for await (const event of new OpenAiCompatibleEngine().startSession(
      buildRequest('openai', baseUrl),
      abortController.signal,
    )) {
      events.push(event);
      if (event.kind === 'text_delta') {
        abortController.abort();
      }
    }

    expect(events.at(-1)).toEqual({ kind: 'cancelled' });
  });
});
