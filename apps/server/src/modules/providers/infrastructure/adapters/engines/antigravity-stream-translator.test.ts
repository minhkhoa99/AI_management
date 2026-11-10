import { describe, expect, it } from 'vitest';
import { AntigravityStreamTranslator } from './antigravity-stream-translator';

const exit = { kind: 'exit', exitCode: 0, stderrTail: '', cancelled: false } as const;
const translator = () => new AntigravityStreamTranslator('C:\\work\\task');
const line = (event: object) => JSON.stringify(event);
const result = (fields: object) =>
  line({
    event: 'result',
    result: {
      conversation_id: 'c1',
      status: 'SUCCESS',
      response: '',
      usage: { input_tokens: 10, output_tokens: 2 },
      ...fields,
    },
  });
const step = (fields: object) =>
  line({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 3, ...fields } });
const toolStep = (state: string, toolName: string, parameters: object, toolInfo: object = {}) =>
  step({
    state,
    step_type: 'tool',
    tool_name: toolName,
    tool_info: { name: toolName, parameters, ...toolInfo },
  });

describe('AntigravityStreamTranslator', () => {
  describe('session and text', () => {
    it('init starts the session with the conversation id and model', () =>
      expect(
        translator().translateAntigravityLine(
          line({ event: 'init', conversation_id: 'c1', init: { model: 'm' } }),
        ),
      ).toEqual([{ kind: 'session_started', sessionRef: 'c1', model: 'm' }]));

    it('streams text deltas and emits one message when the step is done', () => {
      const t = translator();
      const textStep = (state: string, text: string) =>
        step({ step_index: 5, state, step_type: 'agent_response', text_delta: text });

      expect(t.translateAntigravityLine(textStep('ACTIVE', 'Xin '))).toEqual([
        { kind: 'text_delta', text: 'Xin ' },
      ]);
      expect(t.translateAntigravityLine(textStep('DONE', 'chào'))).toEqual([
        { kind: 'text_delta', text: 'chào' },
        { kind: 'message', text: 'Xin chào' },
      ]);
    });

    it('keeps the text of different steps apart', () => {
      const t = translator();
      t.translateAntigravityLine(
        step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'a' }),
      );

      expect(
        t.translateAntigravityLine(
          step({ step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'b' }),
        ),
      ).toEqual([
        { kind: 'text_delta', text: 'b' },
        { kind: 'message', text: 'b' },
      ]);
    });

    it('an agent_response step without text emits nothing', () =>
      expect(
        translator().translateAntigravityLine(step({ state: 'DONE', step_type: 'agent_response' })),
      ).toEqual([]));

    it('a whitespace-only response step emits no message', () =>
      expect(
        translator()
          .translateAntigravityLine(
            step({ state: 'DONE', step_type: 'agent_response', text_delta: '\n' }),
          )
          .map((event) => event.kind),
      ).toEqual(['text_delta']));
  });

  describe('tool steps', () => {
    it('run_command DONE becomes a command event', () =>
      expect(
        translator().translateAntigravityLine(
          toolStep('DONE', 'run_command', { CommandLine: 'echo hi' }, { output: 'hi' }),
        ),
      ).toEqual([{ kind: 'command', command: 'echo hi', exitCode: null, output: 'hi' }]));

    it('run_command output with an exit-code header yields the exit code and the text', () => {
      const t = translator();

      expect(
        t.translateAntigravityLine(
          toolStep(
            'DONE',
            'run_command',
            { CommandLine: 'node --version' },
            {
              output:
                'Created At: 2026-11-11T00:16:05+07:00\nCompleted At: 2026-11-11T00:16:05+07:00\nCommand exited with code 0.\n\nCommand output:\nv24.22.1\n',
            },
          ),
        ),
      ).toEqual([
        { kind: 'command', command: 'node --version', exitCode: 0, output: 'v24.22.1\n' },
      ]);
      expect(
        t.translateAntigravityLine(
          toolStep(
            'DONE',
            'run_command',
            { CommandLine: 'false' },
            { output: 'Command exited with code 1.\n\nNo output from the command.' },
          ),
        ),
      ).toEqual([{ kind: 'command', command: 'false', exitCode: 1, output: '' }]);
    });

    it('run_command ERROR carries the denial message as output', () =>
      expect(
        translator().translateAntigravityLine(
          toolStep(
            'ERROR',
            'run_command',
            { CommandLine: 'echo hi' },
            { error: { type: 'TOOL_ERROR', message: 'Matches user-configured deny rule' } },
          ),
        ),
      ).toEqual([
        {
          kind: 'command',
          command: 'echo hi',
          exitCode: null,
          output: 'Matches user-configured deny rule',
        },
      ]));

    it('write_file inside the working directory is a file change', () =>
      expect(
        translator().translateAntigravityLine(
          toolStep('DONE', 'write_file', { Path: 'C:\\work\\task\\x.txt' }),
        ),
      ).toEqual([{ kind: 'file_change', path: 'C:\\work\\task\\x.txt', changeKind: 'update' }]));

    it('write_file outside the working directory is a plain tool call', () =>
      expect(
        translator().translateAntigravityLine(
          toolStep('DONE', 'write_file', {
            Path: 'C:\\Users\\u\\.gemini\\antigravity-cli\\brain\\c1\\plan.md',
          }),
        ),
      ).toEqual([
        {
          kind: 'tool_call',
          toolName: 'write_file',
          detail: 'C:\\Users\\u\\.gemini\\antigravity-cli\\brain\\c1\\plan.md',
        },
      ]));

    it('a sibling folder sharing the directory name prefix is outside the working directory', () =>
      expect(
        translator()
          .translateAntigravityLine(
            toolStep('DONE', 'write_file', { Path: 'C:\\work\\task2\\x.txt' }),
          )
          .map((event) => event.kind),
      ).toEqual(['tool_call']));

    it('the working-directory check treats POSIX paths the same way on every host', () => {
      const posix = new AntigravityStreamTranslator('/work/task');
      const kindOf = (filePath: string) =>
        posix
          .translateAntigravityLine(toolStep('DONE', 'write_file', { Path: filePath }))
          .map((event) => event.kind);

      expect(
        posix.translateAntigravityLine(
          toolStep('DONE', 'write_file', { Path: '/work/task/x.txt' }),
        ),
      ).toEqual([{ kind: 'file_change', path: '/work/task/x.txt', changeKind: 'update' }]);
      expect(kindOf('/work/task\\sub\\x.txt')).toEqual(['file_change']);
      expect(kindOf('/work/task2/x.txt')).toEqual(['tool_call']);
      expect(kindOf('/work/task/../other/x.txt')).toEqual(['tool_call']);
      expect(kindOf('/Work/Task/x.txt')).toEqual(['tool_call']);
    });

    it('the working-directory check ignores case and separator style for Windows paths', () => {
      const kindOf = (filePath: string) =>
        translator()
          .translateAntigravityLine(toolStep('DONE', 'write_file', { Path: filePath }))
          .map((event) => event.kind);

      expect(kindOf('c:/WORK/task/x.txt')).toEqual(['file_change']);
      expect(kindOf('C:\\work\\task\\..\\other\\x.txt')).toEqual(['tool_call']);
    });

    it('other tools become tool calls; ACTIVE tool steps are ignored', () => {
      const t = translator();

      expect(
        t.translateAntigravityLine(
          toolStep('ACTIVE', 'read_file', { Path: 'C:\\work\\task\\README.md' }),
        ),
      ).toEqual([]);
      expect(
        t.translateAntigravityLine(
          toolStep('DONE', 'read_file', { Path: 'C:\\work\\task\\README.md' }),
        ),
      ).toEqual([
        { kind: 'tool_call', toolName: 'read_file', detail: 'C:\\work\\task\\README.md' },
      ]);
    });

    it.each(['error_message', 'system_message', 'subagent', 'user_input'])(
      'ignores %s steps',
      (stepType) =>
        expect(
          translator().translateAntigravityLine(step({ state: 'DONE', step_type: stepType })),
        ).toEqual([]),
    );
  });

  describe('result', () => {
    it('SUCCESS → usage then completed with the response', () =>
      expect(translator().translateAntigravityLine(result({ response: 'xong' }))).toEqual([
        { kind: 'usage', inputTokens: 10, outputTokens: 2, costUsd: null },
        { kind: 'completed', summary: 'xong' },
      ]));

    it('SUCCESS with an empty response falls back to the last message', () => {
      const t = translator();
      t.translateAntigravityLine(
        step({ step_index: 7, state: 'DONE', step_type: 'agent_response', text_delta: 'Đã xong.' }),
      );

      expect(t.translateAntigravityLine(result({ response: '' })).at(-1)).toEqual({
        kind: 'completed',
        summary: 'Đã xong.',
      });
    });

    it('SUCCESS, denied actions, empty response → ENGINE_PERMISSION_DENIED, not retryable', () =>
      expect(
        translator()
          .translateAntigravityLine(
            result({ denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }),
          )
          .at(-1),
      ).toEqual({
        kind: 'failed',
        code: 'ENGINE_PERMISSION_DENIED',
        message:
          'Antigravity từ chối hành động (RunCommand) và không trả lời. Kiểm tra quyền của agent (mức truy cập, mạng).',
        retryable: false,
      }));

    it('SUCCESS, denied actions, non-empty response → completed', () =>
      expect(
        translator()
          .translateAntigravityLine(
            result({
              response: 'Không chạy được lệnh.',
              denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
            }),
          )
          .at(-1),
      ).toEqual({ kind: 'completed', summary: 'Không chạy được lệnh.' }));

    it('finished_reason print_timeout → ENGINE_TIMEOUT, retryable, whatever the status', () => {
      for (const status of ['SUCCESS', 'ERROR']) {
        expect(
          translator()
            .translateAntigravityLine(result({ status, finished_reason: 'print_timeout' }))
            .at(-1),
        ).toMatchObject({ kind: 'failed', code: 'ENGINE_TIMEOUT', retryable: true });
      }
    });

    it('status ERROR "authentication required" → ENGINE_AUTH_FAILED', () =>
      expect(
        translator().translateAntigravityLine(
          result({ status: 'ERROR', error: 'authentication required' }),
        ),
      ).toContainEqual({
        kind: 'failed',
        code: 'ENGINE_AUTH_FAILED',
        message: 'authentication required',
        retryable: false,
      }));

    it('status ERROR quota/429 → RATE_LIMITED, retryable', () => {
      for (const error of ['Quota exceeded for this model', 'HTTP 429 too many requests']) {
        expect(
          translator()
            .translateAntigravityLine(result({ status: 'ERROR', error }))
            .at(-1),
        ).toEqual({ kind: 'failed', code: 'RATE_LIMITED', message: error, retryable: true });
      }
    });

    it.each([
      'API error (attempt 5): UNAVAILABLE (code 503): No capacity available for model x',
      'The stream was interrupted. Please continue the task you were working on.',
    ])('status ERROR "%s" → ENGINE_UNAVAILABLE, retryable', (error) =>
      expect(
        translator()
          .translateAntigravityLine(result({ status: 'ERROR', error }))
          .at(-1),
      ).toEqual({ kind: 'failed', code: 'ENGINE_UNAVAILABLE', message: error, retryable: true }),
    );

    it('status ERROR unknown model → MODEL_NOT_FOUND, not retryable', () => {
      const error =
        'invalid model selection (--model x): model x is not recognized as a known model';

      expect(
        translator().translateAntigravityLine(
          result({ status: 'ERROR', error, conversation_id: '', usage: undefined }),
        ),
      ).toEqual([{ kind: 'failed', code: 'MODEL_NOT_FOUND', message: error, retryable: false }]);
    });

    it('status ERROR is a failure even when the response is not empty', () =>
      expect(
        translator()
          .translateAntigravityLine(result({ status: 'ERROR', error: 'boom', response: 'partial' }))
          .at(-1),
      ).toEqual({
        kind: 'failed',
        code: 'ENGINE_REPORTED_ERROR',
        message: 'boom',
        retryable: false,
      }));

    it('a second result line emits nothing after the terminal event', () => {
      const t = translator();
      expect(t.translateAntigravityLine(result({ response: 'xong' }))).not.toEqual([]);

      expect(t.translateAntigravityLine(result({ status: 'ERROR', error: 'boom' }))).toEqual([]);
    });

    it.each([
      'tool unavailable',
      'request id 14012 failed',
      'UNAVAILABLE without the code',
      'error 4290 at step 14012',
      'sign in to the preview',
    ])('status ERROR "%s" is not classified by accident', (error) =>
      expect(
        translator()
          .translateAntigravityLine(result({ status: 'ERROR', error }))
          .at(-1),
      ).toEqual({
        kind: 'failed',
        code: 'ENGINE_REPORTED_ERROR',
        message: error,
        retryable: false,
      }),
    );

    it('whole-number 401 and 429 still classify', () => {
      expect(
        translator()
          .translateAntigravityLine(result({ status: 'ERROR', error: 'HTTP 401' }))
          .at(-1),
      ).toMatchObject({ code: 'ENGINE_AUTH_FAILED' });
      expect(
        translator()
          .translateAntigravityLine(result({ status: 'ERROR', error: 'HTTP 429.' }))
          .at(-1),
      ).toMatchObject({ code: 'RATE_LIMITED' });
    });
  });

  describe('exit', () => {
    it('exit after a result emits nothing more', () => {
      const t = translator();
      t.translateAntigravityLine(result({ response: 'xong' }));

      expect(t.translateAntigravityExit(exit)).toEqual([]);
    });

    it('cancelled exit → exactly one cancelled event', () => {
      const t = translator();
      t.translateAntigravityLine(
        line({ event: 'init', conversation_id: 'c1', init: { model: 'm' } }),
      );

      expect(t.translateAntigravityExit({ ...exit, exitCode: 1, cancelled: true })).toEqual([
        { kind: 'cancelled' },
      ]);
    });

    it('cancelling after the result was already reported adds no second terminal event', () => {
      const t = translator();
      t.translateAntigravityLine(result({ response: 'xong' }));

      expect(t.translateAntigravityExit({ ...exit, cancelled: true })).toEqual([]);
    });

    it('exit without a result uses short_error of the AGY_ERROR stderr line', () =>
      expect(
        translator().translateAntigravityExit({
          ...exit,
          exitCode: 3,
          stderrTail: 'x\nAGY_ERROR: {"short_error":"boom","status":"INTERNAL","retryable":false}',
        }),
      ).toEqual([
        { kind: 'failed', code: 'ENGINE_PROCESS_FAILED', message: 'boom', retryable: true },
      ]));

    it('exit without a result falls back to the last stderr line', () =>
      expect(
        translator().translateAntigravityExit({
          ...exit,
          exitCode: 2,
          stderrTail: 'warming up\nsomething broke\n',
        }),
      ).toEqual([
        {
          kind: 'failed',
          code: 'ENGINE_PROCESS_FAILED',
          message: 'something broke',
          retryable: true,
        },
      ]));

    it('exit without a result classifies a known stderr message', () =>
      expect(
        translator().translateAntigravityExit({
          ...exit,
          exitCode: 1,
          stderrTail: 'authentication required',
        }),
      ).toEqual([
        {
          kind: 'failed',
          code: 'ENGINE_AUTH_FAILED',
          message: 'authentication required',
          retryable: false,
        },
      ]));

    it('exit without a result and empty stderr still fails with a message naming the exit code', () => {
      const events = translator().translateAntigravityExit({ ...exit, exitCode: 7 });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'failed',
        code: 'ENGINE_PROCESS_FAILED',
        message: expect.stringContaining('7'),
        retryable: true,
      });
    });
  });

  it('ignores non-JSON lines, unknown events and tool steps with missing fields', () => {
    const t = translator();

    expect(t.translateAntigravityLine('Warning: something')).toEqual([]);
    expect(t.translateAntigravityLine('[1,2]')).toEqual([]);
    expect(t.translateAntigravityLine(line({ event: 'brand_new' }))).toEqual([]);
    expect(t.translateAntigravityLine(line({ event: 'step_update' }))).toEqual([]);
    expect(t.translateAntigravityLine(step({ state: 'DONE', step_type: 'tool' }))).toEqual([]);
    expect(t.translateAntigravityLine(toolStep('DONE', 'run_command', {}))).toEqual([]);
  });
});
