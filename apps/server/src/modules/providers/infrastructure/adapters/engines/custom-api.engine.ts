import { Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { AnthropicApiEngine } from './anthropic-api.engine';
import { OpenAiCompatibleEngine } from './openai-compatible.engine';

/** The "Custom API" brain: routes to the engine matching the connection's wire format. */
@Injectable()
export class CustomApiEngine implements AgentEnginePort {
  constructor(
    private readonly anthropicApiEngine: AnthropicApiEngine,
    private readonly openAiCompatibleEngine: OpenAiCompatibleEngine,
  ) {}

  startSession(request: AgentSessionRequest, signal: AbortSignal): AsyncIterable<AgentEngineEvent> {
    return request.apiConnection?.format === 'anthropic'
      ? this.anthropicApiEngine.startSession(request, signal)
      : this.openAiCompatibleEngine.startSession(request, signal);
  }
}
