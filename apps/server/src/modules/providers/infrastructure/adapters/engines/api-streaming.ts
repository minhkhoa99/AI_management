import { EngineUnavailableError } from '../../../../../shared/errors/app-error';
import type { ApiConnectionCredentials } from '../../../../orchestration/application/ports/agent-engine.port';
import { createApiConnectionError, createApiFailureError } from '../api-http-failure';
import { buildApiRequestTarget, describeApiService } from '../api-endpoints';

export interface ServerSentEvent {
  event: string | null;
  /** The `data:` field of the event (multi-line data joined with newlines). */
  payload: string;
}

/** Without any byte for this long, the stream is considered dead. */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

/**
 * POSTs a streaming generation request. Redirects are refused so the API key is never forwarded
 * to another host. HTTP failures become AppErrors with the retryable flag set.
 */
export async function postStreamingRequest(
  connection: ApiConnectionCredentials,
  requestBody: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const { url, headers } = buildApiRequestTarget(connection, 'generate');
  const serviceLabel = describeApiService(connection);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(requestBody),
      signal,
      redirect: 'error',
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw createApiConnectionError(error, serviceLabel);
  }
  if (!response.ok) {
    const responseText = await response.text();
    throw createApiFailureError(
      response.status,
      response.headers.get('retry-after'),
      responseText,
      serviceLabel,
    );
  }
  if (response.body === null) {
    throw new EngineUnavailableError(`${serviceLabel} không trả về luồng dữ liệu.`);
  }
  return response;
}

/** Minimal text/event-stream parser (event + data fields; comments and ids ignored). */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffered = '';
  let eventName: string | null = null;
  let dataLines: string[] = [];
  try {
    while (true) {
      const { value, done } = await readWithIdleTimeout(reader);
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      let newlineIndex = buffered.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffered.slice(0, newlineIndex).replace(/\r$/, '');
        buffered = buffered.slice(newlineIndex + 1);
        if (line === '') {
          if (dataLines.length > 0) {
            yield { event: eventName, payload: dataLines.join('\n') };
          }
          eventName = null;
          dataLines = [];
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        newlineIndex = buffered.indexOf('\n');
      }
    }
    if (dataLines.length > 0) {
      yield { event: eventName, payload: dataLines.join('\n') };
    }
  } finally {
    reader.releaseLock();
  }
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  let timer: NodeJS.Timeout | undefined;
  const idleTimeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new EngineUnavailableError('API ngừng gửi dữ liệu quá lâu.', { code: 'STREAM_STALLED' }),
        ),
      STREAM_IDLE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([reader.read(), idleTimeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function parseStreamPayload(rawData: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(rawData);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
