import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_ENGINE_OVERRIDE,
  type AgentEngineOverride,
} from '../../../../../shared/runtime/agent-engine-override';
import type { AgentProvider } from '@aiteam/contracts';
import type {
  AgentEnginePort,
  AgentEngineResolver,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { AntigravityCliEngine } from './antigravity-cli.engine';
import { ClaudeCodeCliEngine } from './claude-code-cli.engine';
import { CodexCliEngine } from './codex-cli.engine';
import { CustomApiEngine } from './custom-api.engine';

/** Picks the engine for an agent's provider. Adding an engine never touches orchestration. */
@Injectable()
export class EngineRegistry implements AgentEngineResolver {
  constructor(
    private readonly claudeCodeEngine: ClaudeCodeCliEngine,
    private readonly codexEngine: CodexCliEngine,
    private readonly antigravityEngine: AntigravityCliEngine,
    private readonly customApiEngine: CustomApiEngine,
    @Inject(AGENT_ENGINE_OVERRIDE) private readonly engineOverride: AgentEngineOverride,
  ) {}

  resolveAgentEngine(provider: AgentProvider): AgentEnginePort {
    if (this.engineOverride !== null) {
      return this.engineOverride;
    }
    switch (provider) {
      case 'claude_code':
        return this.claudeCodeEngine;
      case 'codex':
        return this.codexEngine;
      case 'antigravity':
        return this.antigravityEngine;
      case 'custom_api':
        return this.customApiEngine;
    }
  }
}
