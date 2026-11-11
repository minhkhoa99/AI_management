import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  type Department,
  departmentSchema,
  type EngineQuotaBucket,
  type EngineQuotaReport,
  taskDetailSchema,
  taskEventListSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptedEngine, waitFor } from '../../test-support/scripted-engine';
import {
  DEFAULT_FAKE_LOCAL_ENGINES,
  startTestApplication,
  type TestApplication,
} from '../../test-support/test-application';

const RATE_LIMIT = { code: 'RATE_LIMITED', message: 'Hết lượt dùng', retryable: true } as const;

describe('quota wait', () => {
  let app: TestApplication;
  let engine: ScriptedEngine;
  let project: string;
  let department: Department;
  let departmentHead: AgentDetail;
  let quotaState: EngineQuotaReport['state'];
  let quotaBuckets: EngineQuotaBucket[];
  let quotaReads: number;

  const bucket = (over: Partial<EngineQuotaBucket>): EngineQuotaBucket => ({
    group: null,
    window: 'five_hour',
    windowLabel: '5 giờ',
    remainingPercent: 0,
    resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    appliesToModels: null,
    ...over,
  });

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-quota-')));
    mkdirSync(path.join(project, 'shop'));
    writeFileSync(path.join(project, 'shop', 'README.md'), '# shop\n');
    engine = new ScriptedEngine();
    engine.failWith = () => RATE_LIMIT;
    quotaState = 'ok';
    quotaBuckets = [];
    quotaReads = 0;
    app = await startTestApplication(':memory:', {
      agentEngineOverride: engine,
      localEngineAdaptersOverride: {
        ...DEFAULT_FAKE_LOCAL_ENGINES!,
        quotaReaders: [
          {
            engine: 'claude_code',
            readEngineQuota: () => {
              quotaReads += 1;
              return Promise.resolve({ state: quotaState, buckets: quotaBuckets });
            },
          },
        ],
      },
    });
    app.database.prepare('INSERT INTO allowed_directories (path) VALUES (?)').run(project);
    department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    departmentHead = agentDetailSchema.parse(
      (
        await app.callApi('POST', `/api/departments/${department.id}/members`, {
          name: 'Manager Dev',
          role: 'manager',
          provider: 'claude_code',
          reportsToPositionId: null,
        })
      ).body,
    );
    await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
      provider: 'claude_code',
      accessLevel: 'edit_workspace',
      networkAccess: false,
    });
  });

  afterEach(async () => {
    await app.closeApplication();
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  });

  async function startTask(): Promise<string> {
    const response = await app.callApi('POST', '/api/tasks', {
      departmentId: department.id,
      title: 'API đăng nhập',
      criteria: 'Sai mật khẩu trả 401',
      priority: 1,
      workingDirectory: path.join(project, 'shop'),
      workflowId: null,
    });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    return taskDetailSchema.parse(response.body).id;
  }

  const readTask = async (taskId: string) =>
    taskDetailSchema.parse((await app.callApi('GET', `/api/tasks/${taskId}`)).body);
  const readStoredTask = (taskId: string) =>
    app.database
      .prepare('SELECT status, run_after, engine_failures, session_ref FROM tasks WHERE id = ?')
      .get(taskId) as {
      status: string;
      run_after: string | null;
      engine_failures: number;
      session_ref: string | null;
    };
  const waitForRateLimitRecord = (taskId: string) =>
    waitFor(
      () => readTask(taskId),
      (detail) => detail.status === 'queued' && detail.statusNote !== null,
      'queued after the rate limit',
    );

  it('waits until the latest applicable reset without counting a failure', async () => {
    const fiveHourReset = Date.now() + 2 * 3_600_000;
    const weeklyReset = Date.now() + 3 * 24 * 3_600_000;
    quotaBuckets = [
      bucket({ resetsAt: new Date(fiveHourReset).toISOString() }),
      bucket({
        window: 'weekly',
        windowLabel: 'tuần',
        remainingPercent: 0,
        resetsAt: new Date(weeklyReset).toISOString(),
      }),
    ];
    const taskId = await startTask();
    const waiting = await waitForRateLimitRecord(taskId);

    expect(waiting.statusNote).toMatch(
      /^⏸ Chờ hạn mức tuần của Claude Code · tự chạy tiếp lúc \d{2}:\d{2} \d{2}\/\d{2}$/,
    );
    const stored = readStoredTask(taskId);
    expect(stored.engine_failures).toBe(0);
    expect(Date.parse(stored.run_after!)).toBe(weeklyReset + 60_000);
    expect(stored.session_ref).toBe('session-1');
    const events = taskEventListSchema.parse(
      (await app.callApi('GET', `/api/tasks/${taskId}/events?limit=200`)).body,
    );
    expect(events.map((event) => event.kind)).toContain('quota_wait');
    expect(events.map((event) => event.kind)).not.toContain('engine_failed');
    expect(events.find((event) => event.kind === 'quota_wait')?.text).toMatch(
      /^dừng vì hết hạn mức tuần của Claude Code, tự chạy tiếp lúc \d{2}:\d{2} \d{2}\/\d{2}$/,
    );
  }, 60_000);

  it('does not wait when only another model bucket is exhausted', async () => {
    quotaBuckets = [
      bucket({ remainingPercent: 60 }),
      bucket({ group: 'Fable', window: 'weekly', appliesToModels: ['fable'] }),
    ];
    const taskId = await startTask();
    const waiting = await waitForRateLimitRecord(taskId);
    expect(waiting.statusNote).toContain('Bộ não tạm lỗi (RATE_LIMITED)');
    expect(readStoredTask(taskId).engine_failures).toBe(1);
  }, 60_000);

  it('keeps the old back-off when the reset time already passed', async () => {
    quotaBuckets = [bucket({ resetsAt: new Date(Date.now() - 3_600_000).toISOString() })];
    const taskId = await startTask();
    const waiting = await waitForRateLimitRecord(taskId);
    expect(waiting.statusNote).toContain('Bộ não tạm lỗi (RATE_LIMITED); thử lại sau 30 giây');
    expect(readStoredTask(taskId).engine_failures).toBe(1);
  }, 60_000);

  it('keeps the old back-off when the quota cannot be read', async () => {
    quotaState = 'unreadable';
    const taskId = await startTask();
    const waiting = await waitForRateLimitRecord(taskId);
    expect(waiting.statusNote).toContain('thử lại sau 30 giây');
    expect(readStoredTask(taskId).engine_failures).toBe(1);
  }, 60_000);

  it('keeps waiting when the quota is still exhausted after the reset', async () => {
    quotaBuckets = [bucket({})];
    const taskId = await startTask();
    await waitForRateLimitRecord(taskId);
    expect(engine.requests).toHaveLength(1);

    // The reset time passed but the quota stays empty: the scheduler tries again and waits again.
    app.database
      .prepare('UPDATE tasks SET run_after = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), taskId);
    await waitFor(
      () => engine.requests.length,
      (count) => count >= 2,
      'second attempt',
    );
    await waitFor(
      () => readStoredTask(taskId),
      (stored) => stored.status === 'queued' && Date.parse(stored.run_after ?? '') > Date.now(),
      'waiting again',
    );
    expect(readStoredTask(taskId).engine_failures).toBe(0);
  }, 60_000);

  it('asks for a quota refresh after a turn of a local engine', async () => {
    const taskId = await startTask();
    await waitForRateLimitRecord(taskId);
    await waitFor(
      () => quotaReads,
      (count) => count >= 1,
      'quota read',
    );
  }, 60_000);
});
