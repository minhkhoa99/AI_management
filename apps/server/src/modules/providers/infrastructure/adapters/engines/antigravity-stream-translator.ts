import path from 'node:path';
import type { AgentEngineEvent } from '@aiteam/contracts';
import type { CliOutput } from './cli-process';
import { describeToolInput, truncateEngineText } from './engine-text';

type AntigravityExit = Extract<CliOutput, { kind: 'exit' }>;
type FailedEvent = Extract<AgentEngineEvent, { kind: 'failed' }>;

interface AntigravityStep {
  step_index?: number;
  state?: string;
  step_type?: string;
  tool_name?: string;
  text_delta?: string;
  tool_info?: {
    name?: string;
    parameters?: Record<string, unknown>;
    output?: string;
    error?: { message?: string };
  };
}

interface AntigravityResult {
  status?: string;
  response?: string;
  error?: string;
  finished_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  denied_actions?: Array<{ action?: string; display_name?: string }>;
}

interface AntigravityStreamLine {
  event?: string;
  conversation_id?: string;
  init?: { model?: string };
  step_update?: AntigravityStep;
  result?: AntigravityResult;
}

// agy may put "Created At" / "Completed At" lines before the header, so the pattern is not anchored at the start.
const COMMAND_EXIT_PATTERN =
  /Command exited with code (-?\d+)\.\r?\n\r?\n(?:Command output:\r?\n([\s\S]*)|No output from the command\.)$/;
const DRIVE_PATTERN = /^[a-z]:/i;
const AGY_ERROR_PATTERN = /^AGY_ERROR:\s*(\{.*\})\s*$/m;

/**
 * Translates `agy --output-format stream-json` lines into engine events. Tool steps are reported
 * once they finish (the ACTIVE update repeats the same call). Unknown events and steps are ignored.
 */
export class AntigravityStreamTranslator {
  private readonly pendingText = new Map<number, string>();
  private lastMessage: string | null = null;
  private sawTerminalEvent = false;

  constructor(private readonly workingDirectory: string) {}

  translateAntigravityLine(rawLine: string): AgentEngineEvent[] {
    const line = parseJsonLine(rawLine);
    if (line === undefined) {
      return [];
    }
    switch (line.event) {
      case 'init':
        return [
          {
            kind: 'session_started',
            sessionRef: nonEmptyString(line.conversation_id),
            model: nonEmptyString(line.init?.model),
          },
        ];
      case 'step_update':
        return line.step_update === undefined ? [] : this.translateStep(line.step_update);
      case 'result':
        return line.result === undefined ? [] : this.translateResult(line.result);
      default:
        return [];
    }
  }

  translateAntigravityExit(exit: AntigravityExit): AgentEngineEvent[] {
    if (this.sawTerminalEvent) {
      return [];
    }
    this.sawTerminalEvent = true;
    if (exit.cancelled) {
      return [{ kind: 'cancelled' }];
    }
    const message =
      extractAgyErrorMessage(exit.stderrTail) ??
      (exit.stderrTail.trim() === ''
        ? `Antigravity thoát với mã ${exit.exitCode ?? 'không rõ'} mà không trả kết quả.`
        : truncateEngineText(lastMeaningfulLine(exit.stderrTail), 500));
    const failure = classifyAntigravityFailure(message);
    return [
      failure.code === 'ENGINE_REPORTED_ERROR'
        ? { ...failure, code: 'ENGINE_PROCESS_FAILED', retryable: true }
        : failure,
    ];
  }

  private translateStep(step: AntigravityStep): AgentEngineEvent[] {
    switch (step.step_type) {
      case 'agent_response':
        return this.translateResponseStep(step);
      case 'tool':
        return step.state === 'DONE' || step.state === 'ERROR' ? this.translateToolStep(step) : [];
      default:
        // user_input, error_message, system_message, subagent and future step types.
        return [];
    }
  }

  private translateResponseStep(step: AntigravityStep): AgentEngineEvent[] {
    const stepIndex = step.step_index ?? -1;
    const events: AgentEngineEvent[] = [];
    let text = this.pendingText.get(stepIndex) ?? '';
    if (typeof step.text_delta === 'string' && step.text_delta !== '') {
      text += step.text_delta;
      events.push({ kind: 'text_delta', text: step.text_delta });
    }
    if (step.state !== 'DONE') {
      this.pendingText.set(stepIndex, text);
      return events;
    }
    this.pendingText.delete(stepIndex);
    if (text.trim() !== '') {
      this.lastMessage = text.trim();
      events.push({ kind: 'message', text: this.lastMessage });
    }
    return events;
  }

  private translateToolStep(step: AntigravityStep): AgentEngineEvent[] {
    const toolName = step.tool_name ?? step.tool_info?.name;
    if (toolName === undefined) {
      return [];
    }
    const parameters = step.tool_info?.parameters;
    if (toolName === 'run_command') {
      return translateCommandStep(step, parameters);
    }
    const filePath = parameters?.['Path'];
    if (
      toolName === 'write_file' &&
      step.state === 'DONE' &&
      typeof filePath === 'string' &&
      this.isInsideWorkingDirectory(filePath)
    ) {
      return [{ kind: 'file_change', path: filePath, changeKind: 'update' }];
    }
    return [{ kind: 'tool_call', toolName, detail: describeToolInput(lowercaseKeys(parameters)) }];
  }

  private translateResult(result: AntigravityResult): AgentEngineEvent[] {
    this.sawTerminalEvent = true;
    const events: AgentEngineEvent[] = [];
    if (result.usage !== undefined) {
      events.push({
        kind: 'usage',
        inputTokens: result.usage.input_tokens ?? 0,
        outputTokens: result.usage.output_tokens ?? 0,
        costUsd: null,
      });
    }
    events.push(this.decideTerminalEvent(result));
    return events;
  }

  private decideTerminalEvent(result: AntigravityResult): AgentEngineEvent {
    if (result.finished_reason === 'print_timeout') {
      return {
        kind: 'failed',
        code: 'ENGINE_TIMEOUT',
        message: 'Antigravity hết thời gian chờ (print_timeout).',
        retryable: true,
      };
    }
    if (result.status !== 'SUCCESS') {
      return classifyAntigravityFailure(result.error ?? 'Antigravity báo lỗi.');
    }
    const response = result.response ?? '';
    const deniedActions = result.denied_actions ?? [];
    if (response.trim() === '' && deniedActions.length > 0) {
      const names = [
        ...new Set(deniedActions.map((denied) => denied.display_name ?? denied.action ?? '?')),
      ];
      return {
        kind: 'failed',
        code: 'ENGINE_PERMISSION_DENIED',
        message: `Antigravity từ chối hành động (${names.join(', ')}) và không trả lời. Kiểm tra quyền của agent (mức truy cập, mạng).`,
        retryable: false,
      };
    }
    return { kind: 'completed', summary: response.trim() === '' ? this.lastMessage : response };
  }

  private isInsideWorkingDirectory(filePath: string): boolean {
    const root = normaliseForComparison(this.workingDirectory, this.workingDirectory);
    const target = normaliseForComparison(filePath, this.workingDirectory);
    return root.startsWith('/') || DRIVE_PATTERN.test(root)
      ? target.startsWith(root.endsWith('/') ? root : `${root}/`)
      : false;
  }
}

function translateCommandStep(
  step: AntigravityStep,
  parameters: Record<string, unknown> | undefined,
): AgentEngineEvent[] {
  const commandLine = parameters?.['CommandLine'];
  if (typeof commandLine !== 'string') {
    return [];
  }
  const rawOutput = step.tool_info?.output ?? step.tool_info?.error?.message ?? '';
  const exitMatch = COMMAND_EXIT_PATTERN.exec(rawOutput);
  return [
    {
      kind: 'command',
      command: commandLine,
      exitCode: exitMatch === null ? null : Number(exitMatch[1]),
      output: truncateEngineText(exitMatch === null ? rawOutput : (exitMatch[2] ?? '')),
    },
  ];
}

function classifyAntigravityFailure(message: string): FailedEvent {
  if (/authentication required|sign in|log ?in|unauthori[sz]ed|401/i.test(message)) {
    return { kind: 'failed', code: 'ENGINE_AUTH_FAILED', message, retryable: false };
  }
  if (/rate limit|quota|too many requests|429|RESOURCE_EXHAUSTED/i.test(message)) {
    return { kind: 'failed', code: 'RATE_LIMITED', message, retryable: true };
  }
  if (/UNAVAILABLE|code 503|No capacity available|stream was interrupted/i.test(message)) {
    return { kind: 'failed', code: 'ENGINE_UNAVAILABLE', message, retryable: true };
  }
  if (/invalid model selection|not recognized as a known model/i.test(message)) {
    return { kind: 'failed', code: 'MODEL_NOT_FOUND', message, retryable: false };
  }
  return { kind: 'failed', code: 'ENGINE_REPORTED_ERROR', message, retryable: false };
}

/** `AGY_ERROR: {"short_error":"…",…}` is the structured error agy prints on stderr when it dies. */
function extractAgyErrorMessage(stderrTail: string): string | null {
  const match = AGY_ERROR_PATTERN.exec(stderrTail);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]) as { short_error?: unknown };
    return typeof parsed.short_error === 'string' && parsed.short_error !== ''
      ? truncateEngineText(parsed.short_error, 500)
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

/** agy parameter names are PascalCase (`Path`, `Url`); describeToolInput looks for lowercase keys. */
function lowercaseKeys(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return parameters === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [key.toLowerCase(), value]),
      );
}

/**
 * Host-independent path normalisation (never uses node:path's host flavour): backslashes become
 * slashes, `.`/`..` are resolved, and the comparison ignores case when the working directory has a
 * Windows drive letter. Recordings and agy itself mix separators (`/workspace\x.txt`).
 */
function normaliseForComparison(filePath: string, workingDirectory: string): string {
  const normalised = path.posix.normalize(filePath.replaceAll('\\', '/'));
  return DRIVE_PATTERN.test(workingDirectory) ? normalised.toLowerCase() : normalised;
}

function nonEmptyString(value: string | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function lastMeaningfulLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? text;
}

function parseJsonLine(rawLine: string): AntigravityStreamLine | undefined {
  try {
    const parsed: unknown = JSON.parse(rawLine);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as AntigravityStreamLine)
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
