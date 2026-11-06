import { Injectable } from '@nestjs/common';
import type { AgentEngineEvent } from '@aiteam/contracts';
import { AppError } from '../../../../../shared/errors/app-error';
import type {
  AgentEnginePort,
  AgentSessionRequest,
  SessionPermissions,
} from '../../../../orchestration/application/ports/agent-engine.port';
import { type CliInvocation, resolveCliExecutable, streamCliOutput } from './cli-process';
import { ClaudeStreamTranslator } from './claude-stream-translator';
import { toFailedEvent } from './engine-failure';

/** Tools that modify files or run commands: denied for read-only agents. */
const WORKSPACE_MUTATING_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'PowerShell',
];
const NETWORK_TOOLS = ['WebFetch', 'WebSearch'];
/** Shell commands that reach the network, denied with the network tools. */
const NETWORK_COMMAND_RULES = ['Bash(curl:*)', 'Bash(wget:*)', 'PowerShell(Invoke-WebRequest:*)'];
/** Denied even for agents allowed to edit, when the engine blocks dangerous commands. */
const DANGEROUS_COMMAND_RULES = [
  'Bash(rm -rf:*)',
  'Bash(git push:*)',
  'Bash(git reset --hard:*)',
  'Bash(npm publish:*)',
  'PowerShell(Remove-Item:*)',
];

/**
 * Claude Code with the user's signed-in account: `claude -p --output-format stream-json`.
 * User-level settings (personal hooks, plugins, MCP servers) are not loaded, so agents behave the
 * same on every machine; project settings and CLAUDE.md of the worktree still apply.
 */
@Injectable()
export class ClaudeCodeCliEngine implements AgentEnginePort {
  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    let invocation: CliInvocation;
    try {
      invocation = buildClaudeInvocation(request);
    } catch (error) {
      if (error instanceof AppError) {
        yield toFailedEvent(error);
        return;
      }
      throw error;
    }
    const translator = new ClaudeStreamTranslator();
    try {
      for await (const output of streamCliOutput(invocation, signal)) {
        const events =
          output.kind === 'line'
            ? translator.translateClaudeLine(output.text)
            : translator.translateClaudeExit(output);
        yield* events;
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

export function buildClaudeInvocation(request: AgentSessionRequest): CliInvocation {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
    '--permission-mode',
    request.permissions.accessLevel === 'edit_workspace' ? 'acceptEdits' : 'default',
  ];
  if (request.model !== null) {
    args.push('--model', request.model);
  }
  if (request.resumeSessionRef !== null) {
    args.push('--resume', request.resumeSessionRef);
  }
  const allowedTools = request.permissions.networkAccess ? NETWORK_TOOLS : [];
  if (allowedTools.length > 0) {
    args.push('--allowedTools', ...allowedTools);
  }
  args.push('--disallowedTools', ...listDisallowedClaudeTools(request.permissions));
  return {
    executable: resolveCliExecutable('claude'),
    args,
    workingDirectory: request.workingDirectory,
    stdinText: request.prompt,
  };
}

export function listDisallowedClaudeTools(permissions: SessionPermissions): string[] {
  return [
    ...(permissions.accessLevel === 'read_only' ? WORKSPACE_MUTATING_TOOLS : []),
    ...(permissions.networkAccess ? [] : [...NETWORK_TOOLS, ...NETWORK_COMMAND_RULES]),
    ...(permissions.blockDangerousCommands ? DANGEROUS_COMMAND_RULES : []),
  ];
}
