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
  requestEngineQuotaRefresh(): void {}
}

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
    const wait = await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' });
    expect(QUOTA_RESUME_MARGIN_MS).toBe(60_000);
    expect(wait).toEqual({
      runAfter: '2026-11-18T12:00:00.000Z',
      engineLabel: 'Claude Code',
      windowLabel: 'tuần',
    });
  });

  it('labels each local engine', async () => {
    gateway.buckets = [bucket({})];
    expect((await planner.planQuotaWait({ provider: 'codex', model: null }))?.engineLabel).toBe(
      'Codex',
    );
    expect(
      (await planner.planQuotaWait({ provider: 'antigravity', model: null }))?.engineLabel,
    ).toBe('Antigravity');
  });

  it('returns null when only another model bucket is empty', async () => {
    gateway.buckets = [
      bucket({ remainingPercent: 60 }),
      bucket({ group: 'Fable', window: 'weekly', appliesToModels: ['fable'] }),
    ];
    expect(await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' })).toBeNull();
  });

  it('returns null when the quota is unreadable', async () => {
    gateway.state = 'unreadable';
    expect(await planner.planQuotaWait({ provider: 'claude_code', model: 'opus' })).toBeNull();
    gateway.state = 'ok';
  });

  it('never reads the quota for Custom API', async () => {
    gateway.reads.length = 0;
    expect(await planner.planQuotaWait({ provider: 'custom_api', model: 'x' })).toBeNull();
    expect(gateway.reads).toEqual([]);
  });
});
