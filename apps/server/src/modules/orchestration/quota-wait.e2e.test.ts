import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentDetail,
  agentDetailSchema,
  approvalListSchema,
  type Department,
  departmentSchema,
  type EngineQuotaBucket,
  type EngineQuotaReport,
  taskDetailSchema,
  taskEventListSchema,
  workflowSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedEngine, stepNameOf, waitFor } from '../../test-support/scripted-engine';
import { EngineQuotaMonitor } from '../providers/application/use-cases/engine-quota-monitor';
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
  let quotaReadGate: Promise<void> | null;

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
    quotaReadGate = null;
    app = await startTestApplication(':memory:', {
      agentEngineOverride: engine,
      localEngineAdaptersOverride: {
        ...DEFAULT_FAKE_LOCAL_ENGINES!,
        quotaReaders: [
          {
            engine: 'claude_code',
            readEngineQuota: async () => {
              quotaReads += 1;
              // A slow CLI: the test decides when the read ends.
              if (quotaReadGate !== null) await quotaReadGate;
              return { state: quotaState, buckets: quotaBuckets };
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
      .prepare(
        'SELECT status, run_after, engine_failures, session_ref, assignee_agent_id FROM tasks WHERE id = ?',
      )
      .get(taskId) as {
      status: string;
      assignee_agent_id: string | null;
      run_after: string | null;
      engine_failures: number;
      session_ref: string | null;
    };
  /** Holds every quota read until the returned function is called. */
  const holdQuotaReads = (): (() => void) => {
    let release = () => undefined as void;
    quotaReadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  };
  const countQuotaWaitEvents = (taskId: string) =>
    (
      app.database
        .prepare(
          "SELECT COUNT(*) AS total FROM task_events WHERE task_id = ? AND kind = 'quota_wait'",
        )
        .get(taskId) as { total: number }
    ).total;
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

  describe('engine or assignee change', () => {
    const waitUntilDone = (taskId: string) =>
      waitFor(
        () => readTask(taskId),
        (detail) => detail.status === 'succeeded',
        'task runs at once',
      );

    it('runs a waiting task at once after the model changes', async () => {
      quotaBuckets = [bucket({})];
      const taskId = await startTask();
      await waitForRateLimitRecord(taskId);
      engine.failWith = () => null;

      await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
        provider: 'claude_code',
        model: 'sonnet',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });

      await waitUntilDone(taskId);
    }, 60_000);

    it('keeps the wait when the change is not an engine change', async () => {
      quotaBuckets = [bucket({})];
      const taskId = await startTask();
      await waitForRateLimitRecord(taskId);
      const before = readStoredTask(taskId).run_after;

      await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
        provider: 'claude_code',
        accessLevel: 'edit_workspace',
        networkAccess: true,
      });

      expect(readStoredTask(taskId)).toMatchObject({ status: 'queued', run_after: before });
    }, 60_000);

    it('keeps the wait when an edit sends the same assignee', async () => {
      quotaBuckets = [bucket({})];
      const taskId = await startTask();
      await waitForRateLimitRecord(taskId);
      const before = readStoredTask(taskId).run_after;
      const noteBefore = (await readTask(taskId)).statusNote;

      const edit = await app.callApi('PATCH', `/api/tasks/${taskId}`, {
        title: 'API đăng nhập v2',
        assigneeAgentId: departmentHead.id,
      });

      expect(edit.statusCode, JSON.stringify(edit.body)).toBe(200);
      expect(readStoredTask(taskId)).toMatchObject({ status: 'queued', run_after: before });
      expect((await readTask(taskId)).statusNote).toBe(noteBefore);
    }, 60_000);

    it('runs a waiting task at once after it is delegated to a subordinate', async () => {
      const pm = agentDetailSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${department.id}/members`, {
            name: 'PM Linh',
            role: 'pm',
            provider: 'claude_code',
            reportsToPositionId: departmentHead.positionId,
          })
        ).body,
      );
      await app.callApi('PATCH', `/api/agents/${pm.id}/configuration`, {
        provider: 'claude_code',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });
      quotaBuckets = [bucket({})];
      const taskId = await startTask();
      await waitForRateLimitRecord(taskId);
      engine.failWith = () => null;

      const delegation = await app.callApi('POST', `/api/tasks/${taskId}/delegations`, {
        toAgentId: pm.id,
      });

      expect(delegation.statusCode, JSON.stringify(delegation.body)).toBe(201);
      await waitUntilDone(taskId);
    }, 60_000);

    it('keeps a delegation made while the quota is being read', async () => {
      const pm = agentDetailSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${department.id}/members`, {
            name: 'PM Linh',
            role: 'pm',
            provider: 'claude_code',
            reportsToPositionId: departmentHead.positionId,
          })
        ).body,
      );
      await app.callApi('PATCH', `/api/agents/${pm.id}/configuration`, {
        provider: 'claude_code',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });
      quotaBuckets = [bucket({})];
      const releaseQuotaRead = holdQuotaReads();
      const taskId = await startTask();
      await waitFor(
        () => quotaReads,
        (count) => count >= 1,
        'quota read started',
      );
      engine.failWith = () => null;

      const delegation = await app.callApi('POST', `/api/tasks/${taskId}/delegations`, {
        toAgentId: pm.id,
      });
      expect(delegation.statusCode, JSON.stringify(delegation.body)).toBe(201);
      releaseQuotaRead();

      const settled = await waitFor(
        () => readStoredTask(taskId),
        (stored) => stored.status !== 'running',
        'turn settled',
      );
      expect(settled.assignee_agent_id).toBe(pm.id);
      expect(settled.run_after).toBeNull();
      expect(countQuotaWaitEvents(taskId)).toBe(0);
      const done = await waitUntilDone(taskId);
      expect(done.assignee?.id).toBe(pm.id);
      expect(engine.requests).toHaveLength(2);
    }, 60_000);
  });

  it('asks for a quota refresh after a turn of a local engine', async () => {
    const taskId = await startTask();
    await waitForRateLimitRecord(taskId);
    await waitFor(
      () => quotaReads,
      (count) => count >= 1,
      'quota read',
    );
  }, 60_000);
  describe('superior review', () => {
    let reviewWorkflowId: string;
    let pm: AgentDetail;

    beforeEach(async () => {
      pm = agentDetailSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${department.id}/members`, {
            name: 'PM Linh',
            role: 'pm',
            provider: 'claude_code',
            reportsToPositionId: departmentHead.positionId,
          })
        ).body,
      );
      await app.callApi('PATCH', `/api/agents/${pm.id}/configuration`, {
        provider: 'claude_code',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });
      // Tiếp nhận (manager) → Chia task (pm, reviewed by the manager) → Phát triển (no dev here).
      reviewWorkflowId = workflowSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${department.id}/workflows`, {
            name: 'Phần mềm',
            source: { kind: 'template', templateId: 'software' },
          })
        ).body,
      ).id;
    });

    async function startReviewedTask(): Promise<string> {
      const response = await app.callApi('POST', '/api/tasks', {
        departmentId: department.id,
        title: 'API đăng nhập',
        criteria: 'Sai mật khẩu trả 401',
        priority: 1,
        workingDirectory: path.join(project, 'shop'),
        workflowId: reviewWorkflowId,
      });
      expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
      return taskDetailSchema.parse(response.body).id;
    }

    const readReviewPending = (taskId: string) =>
      (
        app.database.prepare('SELECT review_pending FROM tasks WHERE id = ?').get(taskId) as {
          review_pending: number;
        }
      ).review_pending;
    const pendingApprovals = async () =>
      approvalListSchema.parse((await app.callApi('GET', '/api/approvals?status=pending')).body);
    const workedSteps = () => engine.requests.map((request) => stepNameOf(request.prompt));

    it('waits for the quota reset, then opens the review again', async () => {
      let reviewAttempts = 0;
      engine.failWith = (request) => {
        if (stepNameOf(request.prompt) !== 'review') return null;
        reviewAttempts += 1;
        return reviewAttempts === 1 ? RATE_LIMIT : null;
      };
      const reset = Date.now() + 2 * 3_600_000;
      quotaBuckets = [bucket({ resetsAt: new Date(reset).toISOString() })];
      const taskId = await startReviewedTask();

      const waiting = await waitForRateLimitRecord(taskId);
      expect(waiting.statusNote).toMatch(
        /^⏸ Chờ hạn mức 5 giờ của Claude Code · tự chạy tiếp lúc \d{2}:\d{2} \d{2}\/\d{2}$/,
      );
      expect(readReviewPending(taskId)).toBe(1);
      expect(Date.parse(readStoredTask(taskId).run_after!)).toBe(reset + 60_000);
      expect(await pendingApprovals()).toEqual([]);
      expect(workedSteps()).toEqual(['Tiếp nhận và lập kế hoạch', 'Chia task', 'review']);
      const events = taskEventListSchema.parse(
        (await app.callApi('GET', `/api/tasks/${taskId}/events?limit=200`)).body,
      );
      expect(events.map((event) => event.kind)).not.toContain('engine_failed');
      const quotaWait = app.database
        .prepare("SELECT payload_json FROM task_events WHERE task_id = ? AND kind = 'quota_wait'")
        .all(taskId) as Array<{ payload_json: string }>;
      expect(quotaWait).toHaveLength(1);
      expect(JSON.parse(quotaWait[0]!.payload_json)).toMatchObject({
        engine: 'Claude Code',
        windowLabel: '5 giờ',
        reviewerName: 'Manager Dev',
        code: 'RATE_LIMITED',
      });

      // The reset time passed: the next turn is the superior's review again, not the PM's step.
      app.database
        .prepare('UPDATE tasks SET run_after = ? WHERE id = ?')
        .run(new Date(Date.now() - 1000).toISOString(), taskId);
      await waitFor(
        () => readTask(taskId),
        (detail) => detail.currentStep?.name === 'Phát triển',
        'review passed',
      );
      expect(workedSteps()).toEqual(['Tiếp nhận và lập kế hoạch', 'Chia task', 'review', 'review']);
      expect(engine.requests[3]?.permissions.accessLevel).toBe('read_only');
      expect(readReviewPending(taskId)).toBe(0);
    }, 60_000);

    async function waitForReviewQuotaWait(): Promise<string> {
      engine.failWith = (request) => {
        if (stepNameOf(request.prompt) !== 'review') return null;
        return RATE_LIMIT;
      };
      quotaBuckets = [bucket({})];
      const taskId = await startReviewedTask();
      await waitForRateLimitRecord(taskId);
      expect(readReviewPending(taskId)).toBe(1);
      return taskId;
    }

    it('wakes a review that waits for the quota when the engine changes', async () => {
      const taskId = await waitForReviewQuotaWait();
      engine.failWith = () => null;

      await app.callApi('PATCH', `/api/agents/${departmentHead.id}/configuration`, {
        provider: 'claude_code',
        model: 'sonnet',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });

      await waitFor(
        () => readTask(taskId),
        (detail) => detail.currentStep?.name === 'Phát triển',
        'review runs at once',
      );
      expect(workedSteps().filter((step) => step === 'review')).toHaveLength(2);
    }, 60_000);

    it('keeps the review wait when an edit sends the same assignee', async () => {
      const taskId = await waitForReviewQuotaWait();
      const before = readStoredTask(taskId).run_after;
      const waiting = await readTask(taskId);

      const edit = await app.callApi('PATCH', `/api/tasks/${taskId}`, {
        title: 'API đăng nhập v2',
        assigneeAgentId: waiting.assignee!.id,
      });

      expect(edit.statusCode, JSON.stringify(edit.body)).toBe(200);
      expect(readStoredTask(taskId)).toMatchObject({ status: 'queued', run_after: before });
      expect((await readTask(taskId)).statusNote).toBe(waiting.statusNote);
      expect(readReviewPending(taskId)).toBe(1);
    }, 60_000);

    it('drops the pending review when the task is delegated during the wait', async () => {
      const taskId = await waitForReviewQuotaWait();
      engine.failWith = () => null;
      const developer = agentDetailSchema.parse(
        (
          await app.callApi('POST', `/api/departments/${department.id}/members`, {
            name: 'Dev Nam',
            role: 'dev',
            provider: 'claude_code',
            reportsToPositionId: pm.positionId,
          })
        ).body,
      );
      await app.callApi('PATCH', `/api/agents/${developer.id}/configuration`, {
        provider: 'claude_code',
        accessLevel: 'edit_workspace',
        networkAccess: false,
      });

      const delegation = await app.callApi('POST', `/api/tasks/${taskId}/delegations`, {
        toAgentId: developer.id,
      });

      expect(delegation.statusCode, JSON.stringify(delegation.body)).toBe(201);
      expect(readReviewPending(taskId)).toBe(0);
      await waitFor(
        () => workedSteps().length,
        (count) => count >= 4,
        'worker turn',
      );
      expect(workedSteps()[3]).not.toBe('review');
    }, 60_000);

    it('keeps an assignee edit made while the reviewer quota is being read', async () => {
      engine.failWith = (request) => (stepNameOf(request.prompt) === 'review' ? RATE_LIMIT : null);
      quotaBuckets = [bucket({})];
      const releaseQuotaRead = holdQuotaReads();
      const taskId = await startReviewedTask();
      await waitFor(
        () => workedSteps().includes('review') && quotaReads >= 1,
        (started) => started,
        'review quota read started',
      );
      engine.failWith = () => null;

      const edit = await app.callApi('PATCH', `/api/tasks/${taskId}`, {
        assigneeAgentId: departmentHead.id,
      });
      expect(edit.statusCode, JSON.stringify(edit.body)).toBe(200);
      releaseQuotaRead();

      const settled = await waitFor(
        () => readStoredTask(taskId),
        (stored) => stored.status !== 'running',
        'review settled',
      );
      expect(settled.assignee_agent_id).toBe(departmentHead.id);
      expect(settled.run_after).toBeNull();
      expect(countQuotaWaitEvents(taskId)).toBe(0);
      expect(readReviewPending(taskId)).toBe(0);
      await waitFor(
        () => workedSteps().length,
        (count) => count >= 4,
        'turn of the new assignee',
      );
      expect(workedSteps()[3]).not.toBe('review');
      // Let the step finish (checkpoint and review included) before the app and its folders close.
      await waitFor(
        () => readTask(taskId),
        (detail) => detail.currentStep?.name === 'Phát triển',
        'step passed after the edit',
      );
    }, 60_000);

    /** The step that ran last each time a turn's end asked for a quota refresh. */
    const recordRefreshRequests = (): string[] => {
      const requestedAfter: string[] = [];
      const monitor = app.application.get(EngineQuotaMonitor);
      const original = monitor.requestEngineQuotaRefresh.bind(monitor);
      vi.spyOn(monitor, 'requestEngineQuotaRefresh').mockImplementation((quotaEngine) => {
        requestedAfter.push(workedSteps().at(-1) ?? '');
        original(quotaEngine);
      });
      return requestedAfter;
    };

    it('asks for a quota refresh after a review turn', async () => {
      const requestedAfter = recordRefreshRequests();
      engine.failWith = () => null;
      const taskId = await startReviewedTask();
      await waitFor(
        () => readTask(taskId),
        (detail) => detail.currentStep?.name === 'Phát triển',
        'review passed',
      );
      expect(requestedAfter).toContain('review');
    }, 60_000);

    it('asks no extra refresh after a rate-limited review (the planner reads it)', async () => {
      const requestedAfter = recordRefreshRequests();
      const taskId = await waitForReviewQuotaWait();
      expect(readReviewPending(taskId)).toBe(1);
      expect(requestedAfter).not.toContain('review');
    }, 60_000);

    it('asks the user when the rate-limited review has no exhausted bucket', async () => {
      engine.failWith = (request) => (stepNameOf(request.prompt) === 'review' ? RATE_LIMIT : null);
      quotaBuckets = [bucket({ remainingPercent: 60 })];
      const taskId = await startReviewedTask();

      await waitFor(
        () => readTask(taskId),
        (detail) => detail.status === 'waiting_approval',
        'user approval',
      );
      const [approval] = await pendingApprovals();
      expect(approval).toMatchObject({ kind: 'step_gate', stepName: 'Chia task' });
      expect(approval?.summary).toContain('Manager Dev không duyệt được');
      expect(readReviewPending(taskId)).toBe(0);
    }, 60_000);
  });
});
