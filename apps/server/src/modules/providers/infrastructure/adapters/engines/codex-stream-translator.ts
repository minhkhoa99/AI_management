import type { AgentEngineEvent } from '@aiteam/contracts';
import type { CliOutput } from './cli-process';
import { describeToolInput, truncateEngineText } from './engine-text';

type CodexExit = Extract<CliOutput, { kind: 'exit' }>;

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  query?: string;
}

interface CodexStreamLine {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

const FILE_CHANGE_KINDS = new Set(['add', 'update', 'delete']);

/**
 * Translates `codex exec --json` lines into engine events. Only completed items are reported
 * (started/updated items repeat the same content). Unknown types are ignored.
 */
export class CodexStreamTranslator {
  private lastAgentMessage: string | null = null;
  private lastErrorMessage: string | null = null;
  private sawTerminalEvent = false;

  translateCodexLine(rawLine: string): AgentEngineEvent[] {
    const line = parseJsonLine(rawLine);
    if (line === undefined) {
      return [];
    }
    switch (line.type) {
      case 'thread.started':
        return [{ kind: 'session_started', sessionRef: line.thread_id ?? null, model: null }];
      case 'item.completed':
        return line.item === undefined ? [] : this.translateCompletedItem(line.item);
      case 'turn.completed':
        this.sawTerminalEvent = true;
        return [
          {
            kind: 'usage',
            inputTokens: line.usage?.input_tokens ?? 0,
            outputTokens: line.usage?.output_tokens ?? 0,
            costUsd: null,
          },
          { kind: 'completed', summary: this.lastAgentMessage },
        ];
      case 'turn.failed':
        this.sawTerminalEvent = true;
        return [
          classifyCodexFailure(line.error?.message ?? this.lastErrorMessage ?? 'Codex báo lỗi.'),
        ];
      case 'error':
        // Followed by turn.failed when fatal; kept for the final message otherwise.
        this.lastErrorMessage = line.message ?? this.lastErrorMessage;
        return [];
      default:
        return [];
    }
  }

  translateCodexExit(exit: CodexExit): AgentEngineEvent[] {
    if (exit.cancelled) {
      return [{ kind: 'cancelled' }];
    }
    if (this.sawTerminalEvent) {
      return [];
    }
    const message =
      this.lastErrorMessage ??
      (exit.stderrTail.trim() === ''
        ? `Codex thoát với mã ${exit.exitCode ?? 'không rõ'} mà không trả kết quả.`
        : truncateEngineText(lastMeaningfulLine(exit.stderrTail), 500));
    const failure = classifyCodexFailure(message);
    return [
      failure.code === 'ENGINE_REPORTED_ERROR'
        ? { ...failure, code: 'ENGINE_PROCESS_FAILED', retryable: true }
        : failure,
    ];
  }

  private translateCompletedItem(item: CodexItem): AgentEngineEvent[] {
    switch (item.type) {
      case 'agent_message':
        if (typeof item.text !== 'string' || item.text.trim() === '') {
          return [];
        }
        this.lastAgentMessage = item.text;
        return [{ kind: 'message', text: item.text }];
      case 'command_execution':
        return [
          {
            kind: 'command',
            command: item.command ?? '',
            exitCode: typeof item.exit_code === 'number' ? item.exit_code : null,
            output: truncateEngineText(item.aggregated_output ?? ''),
          },
        ];
      case 'file_change':
        return (item.changes ?? []).flatMap((change): AgentEngineEvent[] =>
          typeof change.path === 'string' && FILE_CHANGE_KINDS.has(change.kind ?? '')
            ? [
                {
                  kind: 'file_change',
                  path: change.path,
                  changeKind: change.kind as 'add' | 'update' | 'delete',
                },
              ]
            : [],
        );
      case 'mcp_tool_call':
        return [
          {
            kind: 'tool_call',
            toolName: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}`,
            detail: describeToolInput(item.arguments),
          },
        ];
      case 'web_search':
        return [{ kind: 'tool_call', toolName: 'web_search', detail: item.query ?? '' }];
      case 'error':
        // Non-fatal notices (e.g. missing model metadata); fatal errors arrive as turn.failed.
        this.lastErrorMessage = item.message ?? this.lastErrorMessage;
        return [];
      default:
        return [];
    }
  }
}

function classifyCodexFailure(message: string): Extract<AgentEngineEvent, { kind: 'failed' }> {
  if (
    /sign in again|log ?in again|not logged in|refresh token|unauthori[sz]ed|401/i.test(message)
  ) {
    return { kind: 'failed', code: 'ENGINE_AUTH_FAILED', message, retryable: false };
  }
  if (/rate limit|usage limit|too many requests|429|quota/i.test(message)) {
    return { kind: 'failed', code: 'RATE_LIMITED', message, retryable: true };
  }
  if (
    /model .*(not found|does not exist|not supported)|unknown model|invalid model/i.test(message)
  ) {
    return { kind: 'failed', code: 'MODEL_NOT_FOUND', message, retryable: false };
  }
  return { kind: 'failed', code: 'ENGINE_REPORTED_ERROR', message, retryable: false };
}

function lastMeaningfulLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? text;
}

function parseJsonLine(rawLine: string): CodexStreamLine | undefined {
  try {
    const parsed: unknown = JSON.parse(rawLine);
    return typeof parsed === 'object' && parsed !== null ? (parsed as CodexStreamLine) : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
