import { describe, expect, it } from 'vitest';
import {
  classifyQuotaLevel,
  engineQuotaBucketSchema,
  findLowestQuotaBucket,
  findQuotaExhaustion,
  selectApplicableQuotaBuckets,
  type EngineQuotaBucket,
  type EngineQuotaReport,
} from './engine-quota';

const bucket = (over: Partial<EngineQuotaBucket>): EngineQuotaBucket => ({
  group: null,
  window: 'five_hour',
  windowLabel: '5 giờ',
  remainingPercent: 50,
  resetsAt: '2026-11-11T16:59:00.000Z',
  appliesToModels: null,
  ...over,
});
const report = (buckets: EngineQuotaBucket[]): EngineQuotaReport => ({
  engine: 'claude_code',
  state: 'ok',
  buckets,
  checkedAt: null,
  lastSuccessAt: null,
});

describe('engine quota', () => {
  it('keeps shared buckets and the model-specific bucket matching the model', () => {
    const fable = bucket({ group: 'Fable', window: 'weekly', appliesToModels: ['fable'] });
    const shared = bucket({});
    expect(selectApplicableQuotaBuckets(report([shared, fable]), 'opus')).toEqual([shared]);
    expect(selectApplicableQuotaBuckets(report([shared, fable]), 'fable')).toEqual([shared, fable]);
    expect(selectApplicableQuotaBuckets(report([shared, fable]), null)).toEqual([shared]);
  });
  it('falls back to every group when no group matches the model', () => {
    const gemini = bucket({ group: 'Gemini Models', appliesToModels: ['gemini'] });
    const thirdParty = bucket({
      group: 'Claude and GPT models',
      appliesToModels: ['claude', 'gpt'],
    });
    const all = report([gemini, thirdParty]);
    expect(selectApplicableQuotaBuckets(all, 'claude-opus-4-6-thinking')).toEqual([thirdParty]);
    expect(selectApplicableQuotaBuckets(all, 'argon-1')).toEqual([gemini, thirdParty]);
  });
  it('waits for the latest reset among exhausted buckets', () => {
    const fiveHour = bucket({ remainingPercent: 0, resetsAt: '2026-11-11T16:59:00.000Z' });
    const weekly = bucket({
      window: 'weekly',
      remainingPercent: 0,
      resetsAt: '2026-11-18T11:59:00.000Z',
    });
    expect(findQuotaExhaustion([fiveHour, weekly])?.resetsAt).toBe('2026-11-18T11:59:00.000Z');
    expect(findQuotaExhaustion([bucket({ remainingPercent: 3 })])).toBeNull();
    expect(findQuotaExhaustion([bucket({ remainingPercent: 0, resetsAt: null })])).toBeNull();
  });
  it('picks the lowest bucket (earlier reset wins a tie) and classifies levels', () => {
    const low = bucket({ remainingPercent: 9 });
    expect(findLowestQuotaBucket([bucket({ remainingPercent: 73 }), low])).toBe(low);
    expect(findLowestQuotaBucket([])).toBeNull();
    const later = bucket({ remainingPercent: 9, resetsAt: '2026-11-12T00:00:00.000Z' });
    expect(findLowestQuotaBucket([later, low])).toBe(low);
    expect([classifyQuotaLevel(20), classifyQuotaLevel(19), classifyQuotaLevel(9)]).toEqual([
      'normal',
      'warning',
      'critical',
    ]);
  });
  it('rejects percentages outside 0..100', () => {
    expect(engineQuotaBucketSchema.safeParse(bucket({ remainingPercent: 101 })).success).toBe(
      false,
    );
  });
});
