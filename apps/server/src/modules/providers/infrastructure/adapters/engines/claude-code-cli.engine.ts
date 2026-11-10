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
  SessionPermissions,
} from '../../../../orchestration/application/ports/agent-engine.port';
import {
  type CommandPrefixes,
  DANGEROUS_COMMAND_PREFIXES,
  NETWORK_COMMAND_PREFIXES,
} from '../../../domain/command-restrictions';
import { type CliInvocation, resolveCliExecutable, streamCliOutput } from './cli-process';
import { readClaudeProjectInstructions } from './claude-project-instructions';
import { assertEngineSessionRef } from './engine-session-ref';
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
/** Shell tools pre-approved for agents allowed to edit (deny rules still win). */
const WORKSPACE_COMMAND_TOOLS = ['Bash', 'PowerShell'];
/** Shell commands that reach the network, denied with the network tools. */
const NETWORK_COMMAND_RULES = toClaudeCommandRules(NETWORK_COMMAND_PREFIXES);
/** Denied even for agents allowed to edit, when the engine blocks dangerous commands. */
const DANGEROUS_COMMAND_RULES = toClaudeCommandRules(DANGEROUS_COMMAND_PREFIXES);

function toClaudeCommandRules(prefixes: CommandPrefixes): string[] {
  return [
    ...prefixes.shell.map((prefix) => `Bash(${prefix}:*)`),
    ...prefixes.powershell.map((prefix) => `PowerShell(${prefix}:*)`),
  ];
}

/**
 * Settings from the command line outrank every settings file. With no settings source loaded this
 * is a second guard: hooks never run.
 */
const FLAG_SETTINGS = JSON.stringify({ disableAllHooks: true });

/**
 * Claude Code with the user's signed-in account: `claude -p --output-format stream-json`.
 * No settings file is loaded (`--setting-sources ""`): user settings hold personal hooks, plugins
 * and MCP servers, and `.claude/` in the worktree is written by agents (a hook or apiKeyHelper
 * there would run a command with the user's rights, even in a read-only review). The project's
 * CLAUDE.md files are passed in the prompt instead (readClaudeProjectInstructions).
 */
@Injectable()
export class ClaudeCodeCliEngine implements AgentEnginePort {
  constructor(@Inject(CLI_PROCESS_TRACKER) private readonly processTracker: CliProcessTracker) {}

  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    let invocation: CliInvocation;
    try {
      invocation = buildClaudeInvocation(
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
    const translator = new ClaudeStreamTranslator();
    try {
      for await (const output of streamCliOutput(invocation, signal, this.processTracker)) {
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

export function buildClaudeInvocation(
  request: AgentSessionRequest,
  projectInstructions: string | null = null,
): CliInvocation {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    '',
    '--settings',
    FLAG_SETTINGS,
    '--strict-mcp-config',
    '--permission-mode',
    request.permissions.accessLevel === 'edit_workspace' ? 'acceptEdits' : 'default',
  ];
  if (request.model !== null) {
    args.push('--model', request.model);
  }
  if (request.resumeSessionRef !== null) {
    args.push('--resume', assertEngineSessionRef(request.resumeSessionRef));
  }
  // In print mode nothing can be approved interactively: an agent allowed to edit the workspace
  // may also run commands there (tests, builds); dangerous and network commands stay denied.
  const allowedTools = [
    ...(request.permissions.accessLevel === 'edit_workspace' ? WORKSPACE_COMMAND_TOOLS : []),
    ...(request.permissions.networkAccess ? NETWORK_TOOLS : []),
  ];
  if (allowedTools.length > 0) {
    args.push('--allowedTools', ...allowedTools);
  }
  const disallowedTools = listDisallowedClaudeTools(request.permissions);
  if (disallowedTools.length > 0) {
    // An empty list would leave a bare flag, which the CLI rejects.
    args.push('--disallowedTools', ...disallowedTools);
  }
  return {
    executable: resolveCliExecutable('claude'),
    args,
    workingDirectory: request.workingDirectory,
    stdinText:
      projectInstructions === null
        ? request.prompt
        : [
            'Hướng dẫn của dự án (các file CLAUDE.md, nền tảng đọc giúp bạn):',
            projectInstructions,
            '---',
            request.prompt,
          ].join('\n\n'),
  };
}

export function listDisallowedClaudeTools(permissions: SessionPermissions): string[] {
  return [
    ...(permissions.accessLevel === 'read_only' ? WORKSPACE_MUTATING_TOOLS : []),
    ...(permissions.networkAccess ? [] : [...NETWORK_TOOLS, ...NETWORK_COMMAND_RULES]),
    ...(permissions.blockDangerousCommands ? DANGEROUS_COMMAND_RULES : []),
  ];
}
