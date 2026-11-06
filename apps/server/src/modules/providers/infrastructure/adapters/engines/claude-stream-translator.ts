import type { AgentEngineEvent } from '@aiteam/contracts';
import { describeToolInput, truncateEngineText } from './engine-text';
import type { CliOutput } from './cli-process';

type ClaudeExit = Extract<CliOutput, { kind: 'exit' }>;

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  error?: string;
  message?: { content?: ClaudeContentBlock[] | string };
  tool_use_result?: { type?: string; filePath?: string } | string;
  result?: string;
  is_error?: boolean;
  api_error_status?: number | null;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * Translates `claude -p --output-format stream-json --verbose` lines into engine events.
 * Stateful: remembers tool calls to pair them with their results, and whether a final
 * `result` line arrived. Unknown line types are ignored (the format grows over time).
 */
export class ClaudeStreamTranslator {
  private readonly pendingShellCommands = new Map<string, string>();
  private assistantErrorCode: string | null = null;
  private sawTerminalEvent = false;

  translateClaudeLine(rawLine: string): AgentEngineEvent[] {
    const line = parseJsonLine(rawLine);
    if (line === undefined) {
      return [];
    }
    switch (line.type) {
      case 'system':
        return line.subtype === 'init'
          ? [
              {
                kind: 'session_started',
                sessionRef: line.session_id ?? null,
                model: line.model ?? null,
              },
            ]
          : [];
      case 'assistant':
        if (typeof line.error === 'string') {
          this.assistantErrorCode = line.error;
        }
        return this.translateAssistantContent(line);
      case 'user':
        return this.translateToolResults(line);
      case 'result':
        this.sawTerminalEvent = true;
        return translateResult(line, this.assistantErrorCode);
      default:
        return [];
    }
  }

  /** Called once after the process exits; adds the terminal event when the stream lacked one. */
  translateClaudeExit(exit: ClaudeExit): AgentEngineEvent[] {
    if (exit.cancelled) {
      return [{ kind: 'cancelled' }];
    }
    if (this.sawTerminalEvent) {
      return [];
    }
    return [describeClaudeProcessFailure(exit)];
  }

  private translateAssistantContent(line: ClaudeStreamLine): AgentEngineEvent[] {
    const content = line.message?.content;
    if (!Array.isArray(content) || this.assistantErrorCode !== null) {
      // Error turns (e.g. model_not_found) are reported once, by the result line.
      return [];
    }
    return content.flatMap((block): AgentEngineEvent[] => {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        return [{ kind: 'message', text: block.text }];
      }
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        if (SHELL_TOOLS.has(block.name) && typeof block.id === 'string') {
          this.pendingShellCommands.set(block.id, String(block.input?.command ?? ''));
          return [];
        }
        return [
          { kind: 'tool_call', toolName: block.name, detail: describeToolInput(block.input) },
        ];
      }
      return [];
    });
  }

  private translateToolResults(line: ClaudeStreamLine): AgentEngineEvent[] {
    const content = line.message?.content;
    if (!Array.isArray(content)) {
      return [];
    }
    const events: AgentEngineEvent[] = [];
    for (const block of content) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue;
      }
      const command = this.pendingShellCommands.get(block.tool_use_id);
      if (command !== undefined) {
        this.pendingShellCommands.delete(block.tool_use_id);
        events.push({
          kind: 'command',
          command,
          exitCode: block.is_error === true ? 1 : 0,
          output: truncateEngineText(stringifyToolResult(block.content)),
        });
      }
    }
    const fileResult = line.tool_use_result;
    if (typeof fileResult === 'object' && typeof fileResult.filePath === 'string') {
      if (fileResult.type === 'create' || fileResult.type === 'update') {
        events.push({
          kind: 'file_change',
          path: fileResult.filePath,
          changeKind: fileResult.type === 'create' ? 'add' : 'update',
        });
      }
    }
    return events;
  }
}

function translateResult(
  line: ClaudeStreamLine,
  assistantErrorCode: string | null,
): AgentEngineEvent[] {
  const usage = line.usage ?? {};
  const usageEvent: AgentEngineEvent = {
    kind: 'usage',
    inputTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    costUsd: typeof line.total_cost_usd === 'number' ? line.total_cost_usd : null,
  };
  const resultText = typeof line.result === 'string' ? line.result : null;
  if (line.is_error !== true && line.subtype === 'success') {
    return [usageEvent, { kind: 'completed', summary: resultText }];
  }
  const failureText = resultText ?? `Claude Code dừng với lỗi (${line.subtype ?? 'không rõ'}).`;
  return [
    usageEvent,
    classifyClaudeFailure(failureText, assistantErrorCode, line.api_error_status ?? null),
  ];
}

function classifyClaudeFailure(
  message: string,
  assistantErrorCode: string | null,
  apiErrorStatus: number | null,
): Extract<AgentEngineEvent, { kind: 'failed' }> {
  if (apiErrorStatus === 429 || /rate limit|usage limit|quota/i.test(message)) {
    return { kind: 'failed', code: 'RATE_LIMITED', message, retryable: true };
  }
  if (isClaudeAuthProblem(message) || apiErrorStatus === 401 || apiErrorStatus === 403) {
    return { kind: 'failed', code: 'ENGINE_AUTH_FAILED', message, retryable: false };
  }
  if (assistantErrorCode === 'model_not_found') {
    return { kind: 'failed', code: 'MODEL_NOT_FOUND', message, retryable: false };
  }
  if (apiErrorStatus !== null && apiErrorStatus >= 500) {
    return { kind: 'failed', code: 'ENGINE_UNAVAILABLE', message, retryable: true };
  }
  return { kind: 'failed', code: 'ENGINE_REPORTED_ERROR', message, retryable: false };
}

function describeClaudeProcessFailure(exit: ClaudeExit): AgentEngineEvent {
  const stderrText = exit.stderrTail.trim();
  const message =
    stderrText.length > 0
      ? truncateEngineText(stderrText, 500)
      : `Claude Code thoát với mã ${exit.exitCode ?? 'không rõ'} mà không trả kết quả.`;
  if (isClaudeAuthProblem(stderrText)) {
    return { kind: 'failed', code: 'ENGINE_AUTH_FAILED', message, retryable: false };
  }
  return { kind: 'failed', code: 'ENGINE_PROCESS_FAILED', message, retryable: true };
}

function isClaudeAuthProblem(text: string): boolean {
  return /not logged in|please run \/login|\/login|invalid api key|oauth token|authentication/i.test(
    text,
  );
}

function parseJsonLine(rawLine: string): ClaudeStreamLine | undefined {
  try {
    const parsed: unknown = JSON.parse(rawLine);
    return typeof parsed === 'object' && parsed !== null ? (parsed as ClaudeStreamLine) : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Non-JSON noise on stdout (e.g. a warning) is not an event.
      return undefined;
    }
    throw error;
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}
