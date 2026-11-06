import { Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { AppError, ValidationError } from '../../../../../shared/errors/app-error';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { toFailedEvent } from './engine-failure';
import { parseStreamPayload, postStreamingRequest, readServerSentEvents } from './api-streaming';

interface ChatCompletionChunk {
  id?: string;
  model?: string;
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * OpenAI-compatible Chat Completions (OpenAI, OpenRouter, vLLM, Ollama…), text only, streamed.
 * Only widely supported fields are sent, so compatible servers accept the request.
 */
@Injectable()
export class OpenAiCompatibleEngine implements AgentEnginePort {
  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    try {
      yield* streamChatCompletion(request, signal);
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

async function* streamChatCompletion(
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
    { model: request.model, stream: true, messages: [{ role: 'user', content: request.prompt }] },
    signal,
  );

  let fullText = '';
  let announced = false;
  let finishReason: string | null = null;
  let usage: ChatCompletionChunk['usage'] = null;
  for await (const serverEvent of readServerSentEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (serverEvent.payload.trim() === '[DONE]') {
      break;
    }
    const chunk = parseStreamPayload(serverEvent.payload) as ChatCompletionChunk | undefined;
    if (chunk === undefined) {
      continue;
    }
    if (!announced) {
      announced = true;
      yield {
        kind: 'session_started',
        sessionRef: chunk.id ?? null,
        model: chunk.model ?? request.model,
      };
    }
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text !== '') {
      fullText += text;
      yield { kind: 'text_delta', text };
    }
    finishReason = choice?.finish_reason ?? finishReason;
    usage = chunk.usage ?? usage;
  }

  if (fullText !== '') {
    yield { kind: 'message', text: fullText };
  }
  if (usage !== null && usage !== undefined) {
    yield {
      kind: 'usage',
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      costUsd: null,
    };
  }
  if (finishReason === 'content_filter') {
    yield {
      kind: 'failed',
      code: 'REFUSED',
      message: 'Nội dung bị bộ lọc của nhà cung cấp chặn.',
      retryable: false,
    };
    return;
  }
  yield { kind: 'completed', summary: fullText === '' ? null : fullText };
}
