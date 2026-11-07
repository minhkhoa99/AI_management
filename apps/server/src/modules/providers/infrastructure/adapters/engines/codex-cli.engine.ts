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
import { assertEngineSessionRef } from './engine-session-ref';
import { type CliInvocation, resolveCliExecutable, streamCliOutput } from './cli-process';
import { CodexStreamTranslator } from './codex-stream-translator';
import { toFailedEvent } from './engine-failure';

/**
 * Codex with the user's ChatGPT sign-in: `codex exec --json`. The user's config.toml is ignored
 * (profiles, MCP servers, default model) so runs are reproducible; auth still comes from
 * CODEX_HOME. Permissions map onto Codex's sandbox: read-only, or workspace-write with network
 * only when allowed. Destructive commands are contained by the sandbox (Codex has no per-command
 * deny list on the CLI).
 */
@Injectable()
export class CodexCliEngine implements AgentEnginePort {
  constructor(@Inject(CLI_PROCESS_TRACKER) private readonly processTracker: CliProcessTracker) {}

  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    let invocation: CliInvocation;
    try {
      invocation = buildCodexInvocation(request);
    } catch (error) {
      if (error instanceof AppError) {
        yield toFailedEvent(error);
        return;
      }
      throw error;
    }
    const translator = new CodexStreamTranslator();
    try {
      for await (const output of streamCliOutput(invocation, signal, this.processTracker)) {
        yield* output.kind === 'line'
          ? translator.translateCodexLine(output.text)
          : translator.translateCodexExit(output);
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

export function buildCodexInvocation(request: AgentSessionRequest): CliInvocation {
  const canEdit = request.permissions.accessLevel === 'edit_workspace';
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '-C',
    request.workingDirectory,
    '-s',
    canEdit ? 'workspace-write' : 'read-only',
  ];
  if (request.model !== null) {
    args.push('-m', request.model);
  }
  if (canEdit) {
    args.push('-c', `sandbox_workspace_write.network_access=${request.permissions.networkAccess}`);
  }
  if (request.resumeSessionRef !== null) {
    args.push('resume', assertEngineSessionRef(request.resumeSessionRef));
  }
  // "-" reads the prompt from stdin.
  args.push('-');
  return {
    executable: resolveCliExecutable('codex'),
    args,
    workingDirectory: request.workingDirectory,
    stdinText: request.prompt,
  };
}
