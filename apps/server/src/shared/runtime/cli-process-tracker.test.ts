import { describe, expect, it, vi } from 'vitest';
import { applyPendingMigrations } from '../database/migration-runner';
import { ALL_MIGRATIONS } from '../database/migrations';
import { openSqliteDatabase } from '../database/sqlite-connection';
import type { AppLogger } from '../logging/app-logger';
import { SqliteCliProcessTracker } from './cli-process-tracker';
import type { ProcessIdentity, ProcessInspector } from './process-identity';

function createTracker(inspectProcess: ProcessInspector['inspectProcess']) {
  const database = openSqliteDatabase(':memory:');
  applyPendingMigrations(database, ALL_MIGRATIONS);
  let nextId = 0;
  const logger = { warn: vi.fn() } as unknown as AppLogger;
  const tracker = new SqliteCliProcessTracker(
    database,
    { inspectProcess },
    { generateId: () => `record-${(nextId += 1)}` },
    logger,
  );
  return { tracker, logger };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SqliteCliProcessTracker', () => {
  it('records the CLI with its start time and forgets it once it exited', async () => {
    const { tracker } = createTracker(() => Promise.resolve({ name: 'claude', startedAt: 'T1' }));

    const markExited = tracker.recordSpawnedProcess(4242, 'C:\\tools\\claude.exe');
    await flushPromises();

    expect(tracker.listRecordedProcesses()).toEqual([
      { id: 'record-1', pid: 4242, processName: 'claude', processStartedAt: 'T1' },
    ]);
    markExited();
    expect(tracker.listRecordedProcesses()).toEqual([]);
  });

  it('leaves the start time empty when the PID already belongs to another program', async () => {
    const { tracker } = createTracker(() => Promise.resolve({ name: 'chrome', startedAt: 'T1' }));

    tracker.recordSpawnedProcess(4242, '/usr/bin/codex');
    await flushPromises();

    expect(tracker.listRecordedProcesses()[0]?.processStartedAt).toBeNull();
  });

  it('logs and keeps the record when the start time cannot be read', async () => {
    const { tracker, logger } = createTracker(() =>
      Promise.reject(new Error('powershell missing')),
    );

    tracker.recordSpawnedProcess(4242, 'codex');
    await flushPromises();

    expect(tracker.listRecordedProcesses()[0]?.processStartedAt).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 4242 }),
      'could not read CLI process start time',
    );
  });

  it('does not resurrect a record when the CLI exits before its start time is read', async () => {
    let resolveIdentity: (identity: ProcessIdentity) => void = () => undefined;
    const { tracker } = createTracker(
      () =>
        new Promise<ProcessIdentity>((resolve) => {
          resolveIdentity = resolve;
        }),
    );

    const markExited = tracker.recordSpawnedProcess(4242, 'claude');
    markExited();
    resolveIdentity({ name: 'claude', startedAt: 'T1' });
    await flushPromises();

    expect(tracker.listRecordedProcesses()).toEqual([]);
  });
});
