import { describe, expect, it } from 'vitest';
import type { EngineQuotaBucket, EngineQuotaReport } from './engine-quota';
import { describeEngineQuota, formatQuotaResumeTime } from './engine-quota-display';

const now = new Date('2026-11-11T10:00:00.000Z');
const bucket = (over: Partial<EngineQuotaBucket>): EngineQuotaBucket => ({
  group: null,
  window: 'five_hour',
  windowLabel: '5 giờ',
  remainingPercent: 50,
  resetsAt: now.toISOString(),
  appliesToModels: null,
  ...over,
});
const report = (over: Partial<EngineQuotaReport>): EngineQuotaReport => ({
  engine: 'claude_code',
  state: 'ok',
  buckets: [],
  checkedAt: now.toISOString(),
  lastSuccessAt: null,
  ...over,
});

describe('describeEngineQuota', () => {
  it('shows the lowest bucket with a same-day reset time', () => {
    const result = describeEngineQuota(
      report({ buckets: [bucket({ remainingPercent: 73 }), bucket({ remainingPercent: 42 })] }),
      now,
    );
    expect(result.headline).toMatch(/^42% · 5 giờ · reset \d{2}:\d{2}$/);
    expect(result.level).toBe('normal');
    expect(result.percent).toBe(42);
  });
  it('appends the date when the reset is on another day', () => {
    const result = describeEngineQuota(
      report({
        buckets: [
          bucket({
            remainingPercent: 15,
            resetsAt: '2026-11-18T11:59:00.000Z',
            windowLabel: 'tuần',
          }),
        ],
      }),
      now,
    );
    expect(result.headline).toMatch(/^15% · tuần · reset \d{2}:\d{2} \d{2}\/\d{2}$/);
    expect(result.level).toBe('warning');
  });
  it('omits the reset part when there is none and flags critical', () => {
    const result = describeEngineQuota(
      report({ buckets: [bucket({ remainingPercent: 5, resetsAt: null })] }),
      now,
    );
    expect(result).toEqual({ headline: '5% · 5 giờ', level: 'critical', percent: 5 });
  });
  it('handles ok without buckets', () => {
    expect(describeEngineQuota(report({}), now)).toEqual({
      headline: 'không có hạn mức theo gói',
      level: 'muted',
      percent: null,
    });
  });
  it('handles the non-ok states', () => {
    expect(describeEngineQuota(report({ state: 'not_signed_in' }), now)).toEqual({
      headline: '⚠ chưa đăng nhập',
      level: 'critical',
      percent: null,
    });
    expect(describeEngineQuota(report({ state: 'not_installed' }), now)).toEqual({
      headline: 'chưa cài',
      level: 'muted',
      percent: null,
    });
    expect(describeEngineQuota(report({ state: 'not_applicable' }), now)).toEqual({
      headline: 'không có hạn mức theo gói',
      level: 'muted',
      percent: null,
    });
    expect(describeEngineQuota(report({ state: 'unreadable', checkedAt: null }), now)).toEqual({
      headline: 'đang đọc…',
      level: 'muted',
      percent: null,
    });
  });
  it('keeps old numbers for an unreadable report', () => {
    const withOld = describeEngineQuota(
      report({
        state: 'unreadable',
        buckets: [bucket({ remainingPercent: 30 })],
        lastSuccessAt: '2026-11-11T09:00:00.000Z',
      }),
      now,
    );
    expect(withOld.headline).toMatch(/^không đọc được hạn mức · số lúc \d{2}:\d{2}$/);
    expect(withOld.level).toBe('muted');
    expect(withOld.percent).toBe(30);
    expect(describeEngineQuota(report({ state: 'unreadable' }), now)).toEqual({
      headline: 'không đọc được hạn mức',
      level: 'muted',
      percent: null,
    });
  });
});

describe('formatQuotaResumeTime', () => {
  it('formats HH:mm dd/MM in the local time zone', () => {
    const iso = '2026-11-11T17:00:00.000Z';
    const moment = new Date(iso);
    const two = (value: number) => String(value).padStart(2, '0');
    expect(formatQuotaResumeTime(iso)).toBe(
      `${two(moment.getHours())}:${two(moment.getMinutes())} ${two(moment.getDate())}/${two(moment.getMonth() + 1)}`,
    );
    expect(formatQuotaResumeTime(iso)).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}$/);
  });
});
