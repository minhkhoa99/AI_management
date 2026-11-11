import { describe, expect, it } from 'vitest';
import { type CliOutput, streamCliOutput } from './cli-process';

// A fake CLI: the current Node binary running an inline script.
function fakeCli(script: string) {
  return { command: process.execPath, leadingArgs: ['-e', script] };
}

async function collectOutputs(outputs: AsyncIterable<CliOutput>): Promise<CliOutput[]> {
  const collected: CliOutput[] = [];
  for await (const output of outputs) {
    collected.push(output);
  }
  return collected;
}

describe('streamCliOutput', () => {
  it('yields stdout lines, passes the prompt on stdin, then the exit code and stderr tail', async () => {
    const script = `
      let input = '';
      process.stdin.on('data', (chunk) => (input += chunk));
      process.stdin.on('end', () => {
        console.log(JSON.stringify({ echoed: input }));
        console.log('');
        console.error('warning on stderr');
        process.exit(3);
      });`;

    const outputs = await collectOutputs(
      streamCliOutput(
        {
          executable: fakeCli(script),
          args: [],
          workingDirectory: process.cwd(),
          stdinText: 'xin chào "quoted" --flag',
        },
        new AbortController().signal,
      ),
    );

    expect(outputs).toEqual([
      { kind: 'line', text: '{"echoed":"xin chào \\"quoted\\" --flag"}' },
      { kind: 'exit', exitCode: 3, stderrTail: 'warning on stderr\n', cancelled: false },
    ]);
  });

  it('kills a long-running process within seconds when aborted', async () => {
    const script = `console.log('started'); setInterval(() => console.log('tick'), 200);`;
    const abortController = new AbortController();
    const startedAt = Date.now();
    const outputs: CliOutput[] = [];

    for await (const output of streamCliOutput(
      { executable: fakeCli(script), args: [], workingDirectory: process.cwd(), stdinText: '' },
      abortController.signal,
    )) {
      outputs.push(output);
      if (output.kind === 'line' && output.text === 'started') {
        abortController.abort();
      }
    }

    expect(outputs.at(-1)).toMatchObject({ kind: 'exit', cancelled: true });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('stops the process when the consumer stops reading early', async () => {
    const script = `setInterval(() => console.log(JSON.stringify({ pid: process.pid })), 100);`;
    let childPid: number | undefined;

    for await (const output of streamCliOutput(
      { executable: fakeCli(script), args: [], workingDirectory: process.cwd(), stdinText: '' },
      new AbortController().signal,
    )) {
      if (output.kind === 'line') {
        childPid = (JSON.parse(output.text) as { pid: number }).pid;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(childPid).toBeDefined();
    expect(() => process.kill(childPid as number, 0)).toThrow();
  });

  describe('stdin handling', () => {
    const script = `
      process.stdin.on('data', () => console.log('received'));
      process.stdin.on('end', () => { console.log('stdin-ended'); process.exit(0); });
      process.stdin.resume();
      setTimeout(() => process.exit(0), 5000);`;
    const lineTexts = (outputs: CliOutput[]) =>
      outputs.flatMap((output) => (output.kind === 'line' ? [output.text] : []));

    it('closes stdin after the prompt by default', async () => {
      const outputs = await collectOutputs(
        streamCliOutput(
          {
            executable: fakeCli(script),
            args: [],
            workingDirectory: process.cwd(),
            stdinText: 'x\n',
          },
          AbortSignal.timeout(10_000),
        ),
      );
      expect(lineTexts(outputs)).toContain('stdin-ended');
    });

    it('keeps stdin open when keepStdinOpen is true', async () => {
      const outputs = await collectOutputs(
        streamCliOutput(
          {
            executable: fakeCli(script),
            args: [],
            workingDirectory: process.cwd(),
            stdinText: 'x\n',
            keepStdinOpen: true,
          },
          AbortSignal.timeout(800),
        ),
      );
      expect(lineTexts(outputs)).toContain('received');
      expect(lineTexts(outputs)).not.toContain('stdin-ended');
    });
  });
});
