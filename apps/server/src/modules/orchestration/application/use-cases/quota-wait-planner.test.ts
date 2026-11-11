import type { EngineQuotaBucket, EngineQuotaReport, LocalEngine } from '@aiteam/contracts';
import { describe, expect, it } from 'vitest';
import type { EngineQuotaGateway } from '../ports/engine-quota.port';
import { QUOTA_RESUME_MARGIN_MS, QuotaWaitPlanner } from './quota-wait-planner';

const bucket = (over: Partial<EngineQuotaBucket>): EngineQuotaBucket => ({
  group: null,
  window: 'five_hour',
  windowLabel: '5 giờ',
  remainingPercent: 0,
  resetsAt: '2026-11-11T16:59:00.000Z',
  appliesToModels: null,
  ...over,
});

class FakeQuotaGateway implements EngineQuotaGateway {
  readonly reads: LocalEngine[] = [];
  state: EngineQuotaReport['state'] = 'ok';
  buckets: EngineQuotaBucket[] = [];
  readFreshEngineQuota(engine: LocalEngine): Promise<EngineQuotaReport> {
    this.reads.push(engine);
    return Promise.resolve({
      engine,
      state: this.state,
      buckets: this.buckets,
      checkedAt: null,
      lastSuccessAt: null,
    });
  }
  readonly refreshes: LocalEngine[] = [];
  requestEngineQuotaRefresh(engine: LocalEngine): void {
    this.refreshes.push(engine);
  }
}

const BEFORE_RESET = Date.parse('2026-11-11T10:00:00.000Z');

describe('QuotaWaitPlanner', () => {
  const gateway = new FakeQuotaGateway();
  const planner = new QuotaWaitPlanner(gateway);

  it('waits for the latest applicable reset plus the margin', async () => {
    gateway.buckets = [
      bucket({}),
      bucket({
        window: 'weekly',
        windowLabel: 'tuần',
        remainingPercent: 0,
        resetsAt: '2026-11-18T11:59:00.000Z',
      }),
    ];
    const wait = await planner.planQuotaWait(
      { provider: 'claude_code', model: 'opus' },
      BEFORE_RESET,
    );
    expect(QUOTA_RESUME_MARGIN_MS).toBe(60_000);
    expect(wait).toEqual({
      runAfter: '2026-11-18T12:00:00.000Z',
      engineLabel: 'Claude Code',
      windowLabel: 'tuần',
    });
  });

  it('labels each local engine', async () => {
    gateway.buckets = [bucket({})];
    expect(
      (await planner.planQuotaWait({ provider: 'codex', model: null }, BEFORE_RESET))?.engineLabel,
    ).toBe('Codex');
    expect(
      (await planner.planQuotaWait({ provider: 'antigravity', model: null }, BEFORE_RESET))
        ?.engineLabel,
    ).toBe('Antigravity');
  });

  it('returns null when only another model bucket is empty', async () => {
    gateway.buckets = [
      bucket({ remainingPercent: 60 }),
      bucket({ group: 'Fable', window: 'weekly', appliesToModels: ['fable'] }),
    ];
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, BEFORE_RESET),
    ).toBeNull();
  });

  it('treats a reset that already passed as unknown', async () => {
    gateway.buckets = [bucket({ resetsAt: '2026-11-11T16:59:00.000Z' })];
    const afterMargin = Date.parse('2026-11-11T17:00:00.000Z');
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, afterMargin),
    ).toBeNull();
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, afterMargin - 1),
    ).not.toBeNull();
  });

  it('treats a reset more than 8 days ahead as unknown', async () => {
    gateway.buckets = [bucket({ resetsAt: '2026-12-11T10:00:00.000Z' })];
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, BEFORE_RESET),
    ).toBeNull();
    gateway.buckets = [bucket({ window: 'weekly', resetsAt: '2026-11-18T10:00:00.000Z' })];
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, BEFORE_RESET),
    ).not.toBeNull();
  });

  it('returns null when the quota is unreadable', async () => {
    gateway.state = 'unreadable';
    expect(
      await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' }, BEFORE_RESET),
    ).toBeNull();
    gateway.state = 'ok';
  });

  it('asks a refresh after a turn of a local engine only', () => {
    gateway.refreshes.length = 0;
    planner.requestQuotaRefreshAfterTurn('custom_api');
    planner.requestQuotaRefreshAfterTurn(undefined);
    planner.requestQuotaRefreshAfterTurn('codex');
    expect(gateway.refreshes).toEqual(['codex']);
  });

  it('never reads the quota for Custom API', async () => {
    gateway.reads.length = 0;
    expect(
      await planner.planQuotaWait({ provider: 'custom_api', model: 'x' }, BEFORE_RESET),
    ).toBeNull();
    expect(gateway.reads).toEqual([]);
  });
});
