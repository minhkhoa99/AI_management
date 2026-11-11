import { describe, expect, it } from 'vitest';
import { readQuotaCommandOutput } from './quota-command';

const executable = { command: process.execPath, leadingArgs: [] };

describe('readQuotaCommandOutput', () => {
  it('collects stdout lines and the exit code', async () => {
    const output = await readQuotaCommandOutput({
      executable,
      args: ['-e', 'console.log("one"); console.log("two")'],
      workingDirectory: process.cwd(),
    });
    expect(output.stdout).toBe('one\ntwo');
    expect(output.exitCode).toBe(0);
    expect(output.timedOut).toBe(false);
  });

  it('stops a command that outlives the timeout', async () => {
    const output = await readQuotaCommandOutput({
      executable,
      args: ['-e', 'setTimeout(() => undefined, 30000)'],
      workingDirectory: process.cwd(),
      timeoutMs: 300,
    });
    expect(output.timedOut).toBe(true);
  });
});
