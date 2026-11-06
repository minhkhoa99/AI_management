import { Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { AppError, ValidationError } from '../../../../../shared/errors/app-error';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { toFailedEvent } from './engine-failure';
import { parseStreamPayload, postStreamingRequest, readServerSentEvents } from './api-streaming';

/** Output cap per turn: enough for long answers, accepted by smaller "Anthropic-format" servers too. */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Anthropic Messages API (or a server speaking its format), text only: one user turn, streamed.
 * Thinking blocks and other non-text deltas are ignored. No sampling parameters are sent
 * (API version 2026-10-21 rejects temperature/top_p/top_k). Tool use comes with orchestration.
 */
@Injectable()
export class AnthropicApiEngine implements AgentEnginePort {
  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    try {
      yield* streamAnthropicMessage(request, signal);
    } catch (error) {
      if (signal.aborted) {
        yield { kind: 'cancelled' };
        return;
      }
      if (error instanceof AppError) {
        yield toFailedEvent(error);
        return;
      }
      throw error;
    }
  }
}

async function* streamAnthropicMessage(
  request: AgentSessionRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEngineEvent> {
  if (request.apiConnection === null || request.model === null) {
    throw new ValidationError('Agent Custom API cần kết nối và model.', {
      code: 'CONNECTION_REQUIRED',
    });
  }
  const response = await postStreamingRequest(
    request.apiConnection,
    {
      model: request.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: request.prompt }],
    },
    signal,
  );

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  for await (const serverEvent of readServerSentEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
    const payload = parseStreamPayload(serverEvent.payload);
    switch (payload?.type) {
      case 'message_start': {
        const message = payload.message as {
          id?: string;
          model?: string;
          usage?: { input_tokens?: number };
        };
        inputTokens = message.usage?.input_tokens ?? 0;
        yield {
          kind: 'session_started',
          sessionRef: message.id ?? null,
          model: message.model ?? request.model,
        };
        break;
      }
      case 'content_block_delta': {
        const delta = payload.delta as { type?: string; text?: string };
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          fullText += delta.text;
          yield { kind: 'text_delta', text: delta.text };
        }
        break;
      }
      case 'message_delta': {
        const delta = payload.delta as { stop_reason?: string | null };
        const usage = payload.usage as { output_tokens?: number } | undefined;
        stopReason = delta.stop_reason ?? stopReason;
        outputTokens = usage?.output_tokens ?? outputTokens;
        break;
      }
      case 'error': {
        const streamError = payload.error as { type?: string; message?: string } | undefined;
        const retryable =
          streamError?.type === 'overloaded_error' ||
          streamError?.type === 'api_error' ||
          streamError?.type === 'rate_limit_error';
        yield {
          kind: 'failed',
          code: streamError?.type === 'rate_limit_error' ? 'RATE_LIMITED' : 'ENGINE_REPORTED_ERROR',
          message: streamError?.message ?? 'API báo lỗi giữa chừng.',
          retryable,
        };
        return;
      }
      default:
        break;
    }
  }

  if (fullText !== '') {
    yield { kind: 'message', text: fullText };
  }
  yield { kind: 'usage', inputTokens, outputTokens, costUsd: null };
  if (stopReason === 'refusal') {
    yield {
      kind: 'failed',
      code: 'REFUSED',
      message: 'Model từ chối yêu cầu này.',
      retryable: false,
    };
    return;
  }
  yield { kind: 'completed', summary: fullText === '' ? null : fullText };
}
