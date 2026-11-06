import { Injectable } from '@nestjs/common';
import type { AgentProvider } from '@aiteam/contracts';
import type {
  AgentEnginePort,
  AgentEngineResolver,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { ClaudeCodeCliEngine } from './claude-code-cli.engine';
import { CodexCliEngine } from './codex-cli.engine';
import { CustomApiEngine } from './custom-api.engine';

/** Picks the engine for an agent's provider. Adding an engine never touches orchestration. */
@Injectable()
export class EngineRegistry implements AgentEngineResolver {
  constructor(
    private readonly claudeCodeEngine: ClaudeCodeCliEngine,
    private readonly codexEngine: CodexCliEngine,
    private readonly customApiEngine: CustomApiEngine,
  ) {}

  resolveAgentEngine(provider: AgentProvider): AgentEnginePort {
    switch (provider) {
      case 'claude_code':
        return this.claudeCodeEngine;
      case 'codex':
        return this.codexEngine;
      case 'custom_api':
        return this.customApiEngine;
    }
  }
}
