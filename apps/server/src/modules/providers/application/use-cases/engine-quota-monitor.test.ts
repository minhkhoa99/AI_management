import type { EngineQuotaBucket, LocalEngine, LiveUpdate } from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';
import { createAppLogger } from '../../../../shared/logging/app-logger';
import type { EngineQuotaReader, EngineQuotaReading } from '../ports/engine-quota-reader.port';
import { EngineQuotaMonitor } from './engine-quota-monitor';

interface FakeReader extends EngineQuotaReader {
  calls: number;
}

function bucket(remainingPercent: number): EngineQuotaBucket {
  return {
    group: null,
    window: 'five_hour',
    windowLabel: '5 giờ',
    remainingPercent,
    resetsAt: null,
    appliesToModels: null,
  };
}

function okReading(remainingPercent: number): EngineQuotaReading {
  return { state: 'ok', buckets: [bucket(remainingPercent)] };
}

function fakeReader(engine: LocalEngine, outcomes: Array<EngineQuotaReading | Error>): FakeReader {
  const reader: FakeReader = {
    engine,
    calls: 0,
    readEngineQuota() {
      const outcome = outcomes[Math.min(reader.calls, outcomes.length - 1)];
      reader.calls += 1;
      if (outcome === undefined) throw new Error('no outcome');
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
  return reader;
}

function createMonitor(readers: EngineQuotaReader[]) {
  const hub = new LiveUpdateHub();
  const published: LiveUpdate[] = [];
  hub.subscribeToLiveUpdates((update) => published.push(update));
  const logger = createAppLogger({ level: 'silent' });
  // An override present = tests: no boot read, no timer.
  const monitor = new EngineQuotaMonitor(readers, hub, logger, {});
  return { monitor, published };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EngineQuotaMonitor', () => {
  it('shares one read per engine and keeps the last good numbers when a read fails', async () => {
    const reader = fakeReader('claude_code', [okReading(73), { state: 'unreadable', buckets: [] }]);
    const { monitor } = createMonitor([reader]);
    await Promise.all([
      monitor.readFreshEngineQuota('claude_code'),
      monitor.readFreshEngineQuota('claude_code'),
    ]);
    expect(reader.calls).toBe(1);
    const report = await monitor.readFreshEngineQuota('claude_code');
    expect(report.state).toBe('unreadable');
    expect(report.buckets[0]?.remainingPercent).toBe(73);
    expect(report.lastSuccessAt).not.toBeNull();
  });

  it('clears buckets when the engine is not signed in', async () => {
    const reader = fakeReader('codex', [okReading(50), { state: 'not_signed_in', buckets: [] }]);
    const { monitor } = createMonitor([reader]);
    await monitor.readFreshEngineQuota('codex');
    const report = await monitor.readFreshEngineQuota('codex');
    expect(report.state).toBe('not_signed_in');
    expect(report.buckets).toEqual([]);
    expect(report.lastSuccessAt).not.toBeNull();
  });

  it('spaces refresh requests 30 s apart and announces each read', async () => {
    const reader = fakeReader('claude_code', [okReading(60)]);
    const { monitor, published } = createMonitor([reader]);
    monitor.requestEngineQuotaRefresh('claude_code');
    await vi.advanceTimersByTimeAsync(10_000);
    monitor.requestEngineQuotaRefresh('claude_code');
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(21_000);
    monitor.requestEngineQuotaRefresh('claude_code');
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.calls).toBe(2);
    expect(published).toHaveLength(2);
    expect(published.every((update) => update.type === 'engine_quota.changed')).toBe(true);
  });

  it('lists engines in a fixed order, never-read engines as unreadable', () => {
    const { monitor } = createMonitor([]);
    const reports = monitor.listEngineQuotas();
    expect(reports.map((report) => report.engine)).toEqual(['claude_code', 'codex', 'antigravity']);
    expect(reports.every((report) => report.state === 'unreadable')).toBe(true);
    expect(reports.every((report) => report.checkedAt === null)).toBe(true);
  });

  it('turns a throwing reader into unreadable', async () => {
    const reader = fakeReader('antigravity', [new Error('boom')]);
    const { monitor } = createMonitor([reader]);
    const report = await monitor.readFreshEngineQuota('antigravity');
    expect(report.state).toBe('unreadable');
    expect(report.checkedAt).not.toBeNull();
  });

  it('refreshAllEngineQuotas reads every engine', async () => {
    const readers = (['claude_code', 'codex', 'antigravity'] as const).map((engine) =>
      fakeReader(engine, [okReading(40)]),
    );
    const { monitor } = createMonitor(readers);
    const reports = await monitor.refreshAllEngineQuotas();
    expect(reports.map((report) => report.state)).toEqual(['ok', 'ok', 'ok']);
    expect(readers.map((reader) => reader.calls)).toEqual([1, 1, 1]);
  });

  it('starts no timer and no boot read when an override is present', () => {
    const reader = fakeReader('claude_code', [okReading(40)]);
    const { monitor } = createMonitor([reader]);
    monitor.onModuleInit();
    expect(reader.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    monitor.onModuleDestroy();
  });

  it('reads at boot and every 5 minutes in production, and stops on destroy', async () => {
    const reader = fakeReader('claude_code', [okReading(40)]);
    const monitor = new EngineQuotaMonitor(
      [reader],
      new LiveUpdateHub(),
      createAppLogger({ level: 'silent' }),
      null,
    );
    monitor.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(reader.calls).toBe(2);
    monitor.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(reader.calls).toBe(2);
  });
});
