import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { OsProcessInspector } from './os-process-inspector';
import { isSameProcess, normaliseProcessName } from './process-identity';

// Integration test against the real OS (Windows CIM, Linux /proc or macOS ps).
describe('OsProcessInspector', () => {
  it('reads a stable name and start time for a live process, and null once it exited', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid as number;
    const inspector = new OsProcessInspector();
    try {
      const first = await inspector.inspectProcess(pid);
      const second = await inspector.inspectProcess(pid);

      expect(first?.name).toBe(normaliseProcessName(process.execPath));
      expect(first?.startedAt).toEqual(expect.any(String));
      expect(second).toEqual(first);
      expect(
        isSameProcess({ name: first?.name ?? '', startedAt: first?.startedAt ?? null }, second),
      ).toBe(true);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    expect(await inspector.inspectProcess(pid)).toBeNull();
  }, 60_000);

  it('returns null for impossible PIDs without asking the OS', async () => {
    const inspector = new OsProcessInspector();

    expect(await inspector.inspectProcess(0)).toBeNull();
    expect(await inspector.inspectProcess(-5)).toBeNull();
  });
});

describe('isSameProcess', () => {
  const recorded = { name: 'claude', startedAt: 'T1' };

  it.each([
    ['same name and start time', { name: 'claude', startedAt: 'T1' }, true],
    ['reused PID, other program', { name: 'chrome', startedAt: 'T1' }, false],
    ['reused PID, same program started later', { name: 'claude', startedAt: 'T2' }, false],
    ['no live process', null, false],
  ])('%s → %s', (_label, live, expected) => {
    expect(isSameProcess(recorded, live)).toBe(expected);
  });

  it('never matches when the start time was not recorded', () => {
    expect(
      isSameProcess({ name: 'claude', startedAt: null }, { name: 'claude', startedAt: 'T1' }),
    ).toBe(false);
  });

  it('normalises executable names across platforms', () => {
    expect(normaliseProcessName('C:\\Users\\me\\.local\\bin\\claude.exe')).toBe('claude');
    expect(normaliseProcessName('/usr/local/bin/codex')).toBe('codex');
    expect(normaliseProcessName('CODEX.CMD')).toBe('codex');
  });
});
