import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type AgentEngineEvent, agentEngineEventSchema } from '@aiteam/contracts';
import { describe, expect, it } from 'vitest';
import { AntigravityStreamTranslator } from './antigravity-stream-translator';
import { ClaudeStreamTranslator } from './claude-stream-translator';
import { CodexStreamTranslator } from './codex-stream-translator';

// Contract tests: real CLI output recorded by scripts/record-engine-streams.mjs (sanitised).
// When a CLI changes its format, re-record and fix only the translator.

const fixtureDirectory = path.join(import.meta.dirname, '__fixtures__');

function readFixtureLines(fixtureName: string): string[] {
  return readFileSync(path.join(fixtureDirectory, `${fixtureName}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

type ExitInput = { exitCode: number | null; cancelled: boolean; stderrTail?: string };

function translateClaudeFixture(fixtureName: string, exit: ExitInput): AgentEngineEvent[] {
  const translator = new ClaudeStreamTranslator();
  const events = readFixtureLines(fixtureName).flatMap((line) =>
    translator.translateClaudeLine(line),
  );
  events.push(...translator.translateClaudeExit({ kind: 'exit', stderrTail: '', ...exit }));
  return events.map((event) => agentEngineEventSchema.parse(event));
}

function translateCodexFixture(fixtureName: string, exit: ExitInput): AgentEngineEvent[] {
  const translator = new CodexStreamTranslator();
  const events = readFixtureLines(fixtureName).flatMap((line) =>
    translator.translateCodexLine(line),
  );
  events.push(...translator.translateCodexExit({ kind: 'exit', stderrTail: '', ...exit }));
  return events.map((event) => agentEngineEventSchema.parse(event));
}

// The recordings replace the real workspace folder with /workspace.
function translateAntigravityFixture(fixtureName: string, exit: ExitInput): AgentEngineEvent[] {
  const translator = new AntigravityStreamTranslator('/workspace');
  const events = readFixtureLines(fixtureName).flatMap((line) =>
    translator.translateAntigravityLine(line),
  );
  events.push(...translator.translateAntigravityExit({ kind: 'exit', stderrTail: '', ...exit }));
  return events.map((event) => agentEngineEventSchema.parse(event));
}

function listKinds(events: AgentEngineEvent[]): string[] {
  return events.map((event) => event.kind);
}

function terminalEvents(events: AgentEngineEvent[]): AgentEngineEvent[] {
  return events.filter((event) => ['completed', 'failed', 'cancelled'].includes(event.kind));
}

describe('Claude Code stream (claude -p --output-format stream-json)', () => {
  it('read-only summary: session, read tool, answer, usage with cost, completed', () => {
    const events = translateClaudeFixture('claude-read-only', { exitCode: 0, cancelled: false });

    expect(events[0]).toMatchObject({ kind: 'session_started', model: 'claude-haiku-5-5' });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_call', toolName: 'Read' }));
    expect(events.at(-2)).toMatchObject({ kind: 'usage', costUsd: expect.any(Number) });
    expect(events.at(-1)).toMatchObject({
      kind: 'completed',
      summary: expect.stringMatching(/ghi chú/),
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('edit: reports the created file', () => {
    const events = translateClaudeFixture('claude-edit', { exitCode: 0, cancelled: false });

    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_call', toolName: 'Write' }),
    );
    expect(events).toContainEqual({
      kind: 'file_change',
      path: expect.stringMatching(/hello\.txt$/),
      changeKind: 'add',
    });
    expect(events.at(-1)?.kind).toBe('completed');
  });

  it('modify: an Edit of an existing file is reported as a file change', () => {
    // Regression: Edit results carry no "type"; the monitor never saw files the agent edited.
    const events = translateClaudeFixture('claude-modify', { exitCode: 0, cancelled: false });

    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_call', toolName: 'Edit' }));
    expect(events).toContainEqual({
      kind: 'file_change',
      path: expect.stringMatching(/README\.md$/),
      changeKind: 'update',
    });
    expect(events.at(-1)?.kind).toBe('completed');
  });

  it('cancelled mid-run: ends with exactly one cancelled event', () => {
    const events = translateClaudeFixture('claude-cancelled', { exitCode: 1, cancelled: true });

    expect(events[0]?.kind).toBe('session_started');
    expect(events.at(-1)).toEqual({ kind: 'cancelled' });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('unknown model: a non-retryable MODEL_NOT_FOUND failure', () => {
    const events = translateClaudeFixture('claude-invalid-model', {
      exitCode: 1,
      cancelled: false,
    });

    expect(events.at(-1)).toMatchObject({
      kind: 'failed',
      code: 'MODEL_NOT_FOUND',
      retryable: false,
    });
    expect(listKinds(events)).not.toContain('message');
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('process died without a result line: failure from stderr', () => {
    const translator = new ClaudeStreamTranslator();

    expect(
      translator.translateClaudeExit({
        kind: 'exit',
        exitCode: 1,
        cancelled: false,
        stderrTail: 'Not logged in · Please run /login',
      }),
    ).toEqual([
      {
        kind: 'failed',
        code: 'ENGINE_AUTH_FAILED',
        message: 'Not logged in · Please run /login',
        retryable: false,
      },
    ]);
  });

  it('ignores non-JSON noise and unknown event types', () => {
    const translator = new ClaudeStreamTranslator();

    expect(translator.translateClaudeLine('Warning: something')).toEqual([]);
    expect(translator.translateClaudeLine('{"type":"brand_new_event"}')).toEqual([]);
  });
});

describe('Codex stream (codex exec --json)', () => {
  it('expired sign-in: a non-retryable ENGINE_AUTH_FAILED failure', () => {
    const events = translateCodexFixture('codex-auth-expired', { exitCode: 1, cancelled: false });

    expect(events[0]).toMatchObject({ kind: 'session_started', sessionRef: expect.any(String) });
    expect(events.at(-1)).toMatchObject({
      kind: 'failed',
      code: 'ENGINE_AUTH_FAILED',
      retryable: false,
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('translates messages, commands, file changes and usage', () => {
    const translator = new CodexStreamTranslator();
    const lines = [
      '{"type":"thread.started","thread_id":"t-1"}',
      '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","aggregated_output":"README.md\\n","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"i2","type":"file_change","changes":[{"path":"hello.txt","kind":"add"}],"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"Xong."}}',
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":12}}',
    ];

    const events = lines.flatMap((line) => translator.translateCodexLine(line));

    expect(events).toEqual([
      { kind: 'session_started', sessionRef: 't-1', model: null },
      { kind: 'command', command: 'ls', exitCode: 0, output: 'README.md\n' },
      { kind: 'file_change', path: 'hello.txt', changeKind: 'add' },
      { kind: 'message', text: 'Xong.' },
      { kind: 'usage', inputTokens: 120, outputTokens: 12, costUsd: null },
      { kind: 'completed', summary: 'Xong.' },
    ]);
  });

  it('cancelled: one cancelled event even without turn.failed', () => {
    const translator = new CodexStreamTranslator();
    translator.translateCodexLine('{"type":"thread.started","thread_id":"t-1"}');

    expect(
      translator.translateCodexExit({ kind: 'exit', exitCode: 1, cancelled: true, stderrTail: '' }),
    ).toEqual([{ kind: 'cancelled' }]);
  });

  it.each([
    ['You have hit your usage limit. Try again later.', 'RATE_LIMITED', true],
    ['model "x" does not exist', 'MODEL_NOT_FOUND', false],
    ['something odd', 'ENGINE_REPORTED_ERROR', false],
  ])('classifies "%s" as %s', (message, code, retryable) => {
    const translator = new CodexStreamTranslator();

    expect(
      translator.translateCodexLine(JSON.stringify({ type: 'turn.failed', error: { message } })),
    ).toEqual([{ kind: 'failed', code, message, retryable }]);
  });
});

describe('Antigravity stream (agy --output-format stream-json)', () => {
  it('read-only summary: session, read tool, streamed answer, usage, completed', () => {
    const events = translateAntigravityFixture('antigravity-read-only', {
      exitCode: 0,
      cancelled: false,
    });

    expect(events[0]).toMatchObject({
      kind: 'session_started',
      sessionRef: expect.any(String),
      model: 'gemini-3.8-flash-low',
    });
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_call', toolName: 'read_file' }),
    );
    expect(listKinds(events)).toContain('text_delta');
    expect(listKinds(events)).toContain('message');
    expect(listKinds(events)).not.toContain('file_change');
    expect(events.at(-2)).toMatchObject({ kind: 'usage', costUsd: null });
    expect(events.at(-1)).toMatchObject({
      kind: 'completed',
      summary: expect.stringMatching(/ghi chú/),
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('edit: reports the created file and the command with its exit code', () => {
    const events = translateAntigravityFixture('antigravity-edit', {
      exitCode: 0,
      cancelled: false,
    });

    expect(events).toContainEqual({
      kind: 'file_change',
      path: expect.stringMatching(/hello\.txt$/),
      changeKind: 'update',
    });
    expect(events).toContainEqual({
      kind: 'command',
      command: 'node --version',
      exitCode: 0,
      output: expect.stringMatching(/^v\d+\./),
    });
    expect(events.at(-1)?.kind).toBe('completed');
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('denied command: the tool error is reported and the agent answers, so the run completes', () => {
    const events = translateAntigravityFixture('antigravity-denied-command', {
      exitCode: 0,
      cancelled: false,
    });

    expect(events).toContainEqual({
      kind: 'command',
      command: 'node --version',
      exitCode: null,
      output: expect.stringMatching(/deny rule/),
    });
    expect(events.at(-1)).toMatchObject({ kind: 'completed', summary: expect.any(String) });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('cancelled mid-run: the recording has no result line, the exit yields one cancelled event', () => {
    const events = translateAntigravityFixture('antigravity-cancelled', {
      exitCode: 1,
      cancelled: true,
    });

    expect(events[0]?.kind).toBe('session_started');
    expect(events.at(-1)).toEqual({ kind: 'cancelled' });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it('unknown model: a non-retryable MODEL_NOT_FOUND failure without a session', () => {
    const events = translateAntigravityFixture('antigravity-invalid-model', {
      exitCode: 1,
      cancelled: false,
    });

    expect(events.at(-1)).toMatchObject({
      kind: 'failed',
      code: 'MODEL_NOT_FOUND',
      retryable: false,
    });
    expect(listKinds(events)).not.toContain('session_started');
    expect(terminalEvents(events)).toHaveLength(1);
  });
});
