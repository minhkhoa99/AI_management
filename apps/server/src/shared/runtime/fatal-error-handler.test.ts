import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppLogger } from '../logging/app-logger';
import { type FatalErrorHandlerDependencies, shutDownAfterFatalError } from './fatal-error-handler';

describe('shutDownAfterFatalError', () => {
  let crashDirectory: string;
  let logLines: string[];

  beforeEach(() => {
    crashDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-crash-'));
    logLines = [];
  });

  afterEach(() => {
    rmSync(crashDirectory, { recursive: true, force: true });
  });

  function createDependencies(overrides: Partial<FatalErrorHandlerDependencies> = {}) {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const calls: string[] = [];
    const dependencies: FatalErrorHandlerDependencies = {
      logger: createAppLogger({ level: 'info', destinationStream: sink }),
      sessionSupervisor: {
        countActiveSessions: () => 2,
        cancelAllSessions: vi.fn((timeoutMs: number) => {
          calls.push(`cancel sessions within ${timeoutMs} ms`);
          return Promise.resolve({ unfinishedOwners: [] });
        }),
      },
      crashDirectory,
      appVersion: '9.9.9',
      exitProcess: vi.fn((exitCode: number) => {
        calls.push(`exit ${exitCode}`);
      }),
      writeToTerminal: vi.fn((text: string) => {
        calls.push(`terminal: ${text.trim().split('\n')[0]}`);
      }),
      ...overrides,
    };
    return { dependencies, calls };
  }

  it('logs fatal with stack, writes a crash report, cancels sessions, then exits 1 with instructions', async () => {
    const { dependencies, calls } = createDependencies();

    await shutDownAfterFatalError(
      'unhandledRejection',
      new TypeError('boom in a promise'),
      dependencies,
    );

    expect(calls).toEqual([
      'cancel sessions within 5000 ms',
      'terminal: AI Team gặp lỗi nghiêm trọng và đã dừng để bảo vệ dữ liệu.',
      'exit 1',
    ]);
    const fatalLine = JSON.parse(logLines.find((line) => line.includes('"fatal"')) ?? '{}') as {
      err?: { stack?: string };
      kind?: string;
    };
    expect(fatalLine.kind).toBe('unhandledRejection');
    expect(fatalLine.err?.stack).toContain('boom in a promise');

    const [crashFile] = readdirSync(crashDirectory);
    expect(crashFile).toMatch(/^crash-.*\.json$/);
    const report = JSON.parse(
      readFileSync(path.join(crashDirectory, crashFile ?? ''), 'utf8'),
    ) as Record<string, unknown>;
    expect(report).toMatchObject({
      kind: 'unhandledRejection',
      appVersion: '9.9.9',
      activeSessions: 2,
      traceId: null,
      error: {
        name: 'TypeError',
        message: 'boom in a promise',
        stack: expect.stringContaining('TypeError'),
      },
    });
    expect(String(vi.mocked(dependencies.writeToTerminal).mock.calls[0]?.[0])).toContain(
      'Chạy lại: aiteam',
    );
  });

  it('still exits 1 when cancelling sessions fails', async () => {
    const { dependencies } = createDependencies({
      sessionSupervisor: {
        countActiveSessions: () => 1,
        cancelAllSessions: () => Promise.reject(new Error('supervisor broken')),
      },
    });

    await shutDownAfterFatalError('uncaughtException', 'not even an Error', dependencies);

    expect(dependencies.exitProcess).toHaveBeenCalledWith(1);
  });
});
