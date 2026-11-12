import {
  activityListSchema,
  departmentSchema,
  hourlyThroughputSchema,
  type LiveUpdate,
  overviewMetricsSchema,
  providerUsageSchema,
  taskDetailSchema,
  taskEventListSchema,
  usageTodaySchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveUpdateHub } from '../../shared/events/live-update-hub';
import { startTestApplication, type TestApplication } from '../../test-support/test-application';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../orchestration/application/ports/task-execution.ports';

describe('task log, live updates and overview figures', () => {
  let app: TestApplication;
  let taskId: string;
  let agentIds: { claude: string; api: string };
  let eventLog: TaskEventLog;
  let updates: LiveUpdate[];

  beforeEach(async () => {
    app = await startTestApplication();
    const department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    const head = (
      await app.callApi('POST', `/api/departments/${department.id}/members`, {
        name: 'Manager Dev',
        role: 'manager',
        provider: 'claude_code',
        reportsToPositionId: null,
      })
    ).body as { id: string; positionId: string };
    app.database.exec(
      "INSERT INTO provider_connections (id, name, format, base_url) VALUES ('conn', 'Local', 'openai', 'http://127.0.0.1:1')",
    );
    const apiAgent = (
      await app.callApi('POST', `/api/departments/${department.id}/members`, {
        name: 'Writer API',
        role: 'writer',
        provider: 'custom_api',
        connectionId: 'conn',
        reportsToPositionId: head.positionId,
      })
    ).body as { id: string };
    agentIds = { claude: head.id, api: apiAgent.id };
    taskId = taskDetailSchema.parse(
      (
        await app.callApi('POST', '/api/tasks', {
          departmentId: department.id,
          title: 'Viết bài',
          priority: 2,
        })
      ).body,
    ).id;
    eventLog = app.application.get(TASK_EVENT_LOG);
    updates = [];
    app.application.get(LiveUpdateHub).subscribeToLiveUpdates((update) => updates.push(update));
  });

  afterEach(async () => {
    await app.closeApplication();
  });

  it('buffers events, shows them on read and streams each new line once written', async () => {
    eventLog.recordTaskEvent({
      taskId,
      agentId: agentIds.claude,
      kind: 'message',
      payload: { text: 'Đang đọc mã nguồn' },
    });
    eventLog.recordTaskEvent({
      taskId,
      agentId: agentIds.claude,
      kind: 'usage',
      payload: { inputTokens: 10, outputTokens: 5 },
    });
    expect(updates.filter((update) => update.type === 'task.event')).toHaveLength(0);

    const events = taskEventListSchema.parse(
      (await app.callApi('GET', `/api/tasks/${taskId}/events`)).body,
    );

    expect(events.map((event) => event.text)).toEqual(['Đang đọc mã nguồn']);
    const streamed = updates.filter((update) => update.type === 'task.event');
    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toMatchObject({
      taskId,
      event: { agentName: 'Manager Dev', text: 'Đang đọc mã nguồn' },
    });
  });

  it('writes on its own after 200 ms and drops events of a deleted task', async () => {
    eventLog.recordTaskEvent({ taskId, agentId: null, kind: 'message', payload: { text: 'a' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stored = app.database.prepare('SELECT COUNT(*) AS amount FROM task_events').get();

    eventLog.recordTaskEvent({ taskId, agentId: null, kind: 'message', payload: { text: 'late' } });
    await app.callApi('DELETE', `/api/tasks/${taskId}`);
    eventLog.flushPendingEvents();

    expect(stored).toEqual({ amount: 1 });
    expect(app.database.prepare('SELECT COUNT(*) AS amount FROM task_events').get()).toEqual({
      amount: 0,
    });
    expect(
      updates.some((update) => update.type === 'task.changed' && update.taskId === taskId),
    ).toBe(true);
  });

  it('summarises today: tasks done, QC rate, tokens per engine, cost of Custom API only, activity', async () => {
    const record = (agentId: string | null, kind: string, payload: Record<string, unknown>) =>
      eventLog.recordTaskEvent({ taskId, agentId, kind, payload });
    record(agentIds.claude, 'usage', { inputTokens: 1000, outputTokens: 500, costUsd: 0.4 });
    record(agentIds.api, 'usage', { inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    record(agentIds.claude, 'gate_evaluated', { gate: 'qc_pass', passed: true });
    record(agentIds.claude, 'gate_evaluated', { gate: 'qc_pass', passed: false });
    record(agentIds.claude, 'gate_evaluated', { gate: 'qc_pass', passed: true });
    record(agentIds.claude, 'step_retried', { detail: null });
    record(agentIds.claude, 'task_succeeded', { detail: null });

    const metrics = overviewMetricsSchema.parse(
      (await app.callApi('GET', '/api/overview/metrics')).body,
    );
    const hourly = hourlyThroughputSchema.parse(
      (await app.callApi('GET', '/api/overview/throughput')).body,
    );
    const byProvider = providerUsageSchema.parse(
      (await app.callApi('GET', '/api/overview/usage-by-provider')).body,
    );
    const today = usageTodaySchema.parse(
      (await app.callApi('GET', '/api/overview/usage-today')).body,
    );
    const activity = activityListSchema.parse(
      (await app.callApi('GET', '/api/activity?limit=3')).body,
    );

    expect(metrics).toMatchObject({
      tasksDoneToday: 1,
      qcPassRateToday: 67,
      tokensToday: 1800,
      apiCostTodayUsd: 0.02,
      agentsTotal: 2,
      agentsEnabled: 2,
    });
    expect(metrics.tasksDoneByDay).toHaveLength(7);
    const thisHour = hourly.at(-1);
    expect(thisHour).toMatchObject({ hour: new Date().getHours(), done: 1, reworked: 1 });
    expect(byProvider).toEqual([
      { provider: 'claude_code', tokens: 1500, turns: 1, costUsd: null },
      { provider: 'codex', tokens: 0, turns: 0, costUsd: null },
      { provider: 'antigravity', tokens: 0, turns: 0, costUsd: null },
      { provider: 'custom_api', tokens: 300, turns: 1, costUsd: 0.02 },
    ]);
    expect(today).toEqual({ tokens: 1800, turns: 2 });
    expect(activity.map((item) => item.kind)).toEqual(['task_succeeded', 'step_retried']);
    expect(activity[0]).toMatchObject({
      agentName: 'Manager Dev',
      task: { code: 'T-1', title: 'Viết bài' },
    });
  });
});
