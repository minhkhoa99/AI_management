import { Inject, Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { AppError } from '../../../../../shared/errors/app-error';
import {
  CLI_PROCESS_TRACKER,
  type CliProcessTracker,
} from '../../../../../shared/runtime/cli-process-tracker';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { buildAntigravitySettings } from './antigravity-settings';
import { AntigravityStreamTranslator } from './antigravity-stream-translator';
import { clearEngineManagedPaths } from './antigravity-workspace-guard';
import {
  prependProjectInstructions,
  readClaudeProjectInstructions,
} from './claude-project-instructions';
import { type CliInvocation, resolveCliExecutable, streamCliOutput } from './cli-process';
import { toFailedEvent } from './engine-failure';
import { assertEngineSessionRef } from './engine-session-ref';

/**
 * Antigravity with the user's signed-in account: `agy --output-format stream-json`.
 * Permissions go through a per-run `--settings` JSON (allow/deny rules, pattern-based like Claude
 * Code's, not a sandbox). agy loads hooks, MCP servers and plugins from config folders in the
 * workspace and has no flag to disable that, so those folders are cleared before every run
 * (clearEngineManagedPaths). agy still loads the user's own config under `~/.gemini/config`
 * (accepted). The project's CLAUDE.md files are passed in the prompt (readClaudeProjectInstructions).
 */
@Injectable()
export class AntigravityCliEngine implements AgentEnginePort {
  constructor(@Inject(CLI_PROCESS_TRACKER) private readonly processTracker: CliProcessTracker) {}

  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    let invocation: CliInvocation;
    try {
      await clearEngineManagedPaths(request.workingDirectory, request.workspaceRoot);
      invocation = buildAntigravityInvocation(
        request,
        readClaudeProjectInstructions(request.workingDirectory),
      );
    } catch (error) {
      if (error instanceof AppError) {
        yield toFailedEvent(error);
        return;
      }
      throw error;
    }
    const translator = new AntigravityStreamTranslator(request.workingDirectory);
    try {
      for await (const output of streamCliOutput(invocation, signal, this.processTracker)) {
        yield* output.kind === 'line'
          ? translator.translateAntigravityLine(output.text)
          : translator.translateAntigravityExit(output);
      }
    } catch (error) {
      if (error instanceof AppError) {
        yield toFailedEvent(error);
        return;
      }
      throw error;
    }
  }
}

export function buildAntigravityInvocation(
  request: AgentSessionRequest,
  projectInstructions: string | null = null,
): CliInvocation {
  const args = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--settings',
    JSON.stringify(buildAntigravitySettings(request.permissions)),
  ];
  if (request.model !== null) {
    args.push('--model', request.model);
  }
  if (request.resumeSessionRef !== null) {
    args.push('--conversation', assertEngineSessionRef(request.resumeSessionRef));
  }
  const userEvent = {
    event: 'user',
    message: { content: prependProjectInstructions(request.prompt, projectInstructions) },
  };
  return {
    executable: resolveCliExecutable('agy'),
    args,
    workingDirectory: request.workingDirectory,
    stdinText: `${JSON.stringify(userEvent)}\n`,
  };
}
