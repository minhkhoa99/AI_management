import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../../shared/database/migration-runner';
import { ALL_MIGRATIONS } from '../../shared/database/migrations';
import { openSqliteDatabase } from '../../shared/database/sqlite-connection';
import type { ProcessIdentity } from '../../shared/runtime/process-identity';
import { startTestApplication } from '../../test-support/test-application';

const RECORDED_START = '2026-11-07T08:00:00.0000000Z';

interface SimulatedProcess {
  pid: number;
  recordedName: string;
  recordedStart: string | null;
  /** What the OS reports now for this PID (null = no such process). */
  live: ProcessIdentity | null;
}

const SIMULATED_PROCESSES: SimulatedProcess[] = [
  // Our orphaned CLI, still running: must be killed.
  {
    pid: 1001,
    recordedName: 'claude',
    recordedStart: RECORDED_START,
    live: { name: 'claude', startedAt: RECORDED_START },
  },
  {
    pid: 1002,
    recordedName: 'codex',
    recordedStart: RECORDED_START,
    live: { name: 'codex', startedAt: RECORDED_START },
  },
  // PID reused by another program (different name): must be left alone.
  {
    pid: 1003,
    recordedName: 'claude',
    recordedStart: RECORDED_START,
    live: { name: 'chrome', startedAt: RECORDED_START },
  },
  // PID reused by a new claude started later (different start time): must be left alone.
  {
    pid: 1004,
    recordedName: 'codex',
    recordedStart: RECORDED_START,
    live: { name: 'codex', startedAt: '2026-11-07T09:30:00.0000000Z' },
  },
  // Start time never captured: cannot prove identity, left alone.
  {
    pid: 1005,
    recordedName: 'claude',
    recordedStart: null,
    live: { name: 'claude', startedAt: RECORDED_START },
  },
  // Already exited.
  { pid: 1006, recordedName: 'claude', recordedStart: RECORDED_START, live: null },
  // Not a CLI aiteam starts, even if everything matches.
  {
    pid: 1007,
    recordedName: 'explorer',
    recordedStart: RECORDED_START,
    live: { name: 'explorer', startedAt: RECORDED_START },
  },
];

describe('startup recovery after an abrupt stop', () => {
  let dataDirectory: string;
  let databaseFile: string;

  beforeEach(() => {
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-recovery-'));
    databaseFile = path.join(dataDirectory, 'aiteam.db');
    // State left by a previous run that crashed.
    const database = openSqliteDatabase(databaseFile);
    applyPendingMigrations(database, ALL_MIGRATIONS);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#60A5FA');
      INSERT INTO tasks (id, department_id, title, priority, status, session_ref) VALUES
        ('t-running', 'dev', 'Đang chạy', 1, 'running', 'claude-session-42'),
        ('t-cancelling', 'dev', 'Đang huỷ', 2, 'cancelling', 'codex-thread-7'),
        ('t-queued', 'dev', 'Chờ', 2, 'queued', NULL),
        ('t-waiting', 'dev', 'Chờ duyệt', 2, 'waiting_approval', 'claude-session-43'),
        ('t-done', 'dev', 'Xong', 3, 'succeeded', 'claude-session-1');
    `);
    const insertProcess = database.prepare(
      'INSERT INTO cli_process_records (id, pid, process_name, process_started_at) VALUES (?, ?, ?, ?)',
    );
    for (const simulated of SIMULATED_PROCESSES) {
      insertProcess.run(
        `record-${simulated.pid}`,
        simulated.pid,
        simulated.recordedName,
        simulated.recordedStart,
      );
    }
    database.close();
  });

  afterEach(() => {
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  async function restartApplication() {
    const killedPids: number[] = [];
    const app = await startTestApplication(databaseFile, {
      processInspector: {
        inspectProcess: (pid) =>
          Promise.resolve(
            SIMULATED_PROCESSES.find((simulated) => simulated.pid === pid)?.live ?? null,
          ),
      },
      processTerminator: { terminateProcessTree: (pid) => killedPids.push(pid) },
    });
    return { app, killedPids };
  }

  it('kills only processes whose PID, name and start time all match the record', async () => {
    const { app, killedPids } = await restartApplication();

    expect(killedPids.sort()).toEqual([1001, 1002]);
    expect(
      app.database.prepare('SELECT COUNT(*) AS remaining FROM cli_process_records').get(),
    ).toEqual({ remaining: 0 });
    await app.closeApplication();
  });

  it('puts running tasks back in the queue keeping session_ref, and completes cancellations', async () => {
    const { app } = await restartApplication();

    const tasks = app.database
      .prepare('SELECT id, status, session_ref FROM tasks ORDER BY id')
      .all() as Array<{ id: string; status: string; session_ref: string | null }>;
    expect(tasks).toEqual([
      { id: 't-cancelling', status: 'cancelled', session_ref: 'codex-thread-7' },
      { id: 't-done', status: 'succeeded', session_ref: 'claude-session-1' },
      { id: 't-queued', status: 'queued', session_ref: null },
      { id: 't-running', status: 'queued', session_ref: 'claude-session-42' },
      { id: 't-waiting', status: 'waiting_approval', session_ref: 'claude-session-43' },
    ]);
    await app.closeApplication();
  });

  it('serves requests normally after recovery', async () => {
    const { app } = await restartApplication();

    expect((await app.callApi('GET', '/api/health')).statusCode).toBe(200);
    await app.closeApplication();
  });
});
