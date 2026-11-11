import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClaudeResetTime, parseClaudeUsage } from './cli-claude-quota.reader';

function readFixture(fixtureName: string): string {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', fixtureName), 'utf8');
}

const NOW = new Date('2026-11-11T16:28:00.000Z'); // 23:28 Asia/Ho_Chi_Minh

describe('parseClaudeUsage', () => {
  it('reads session and weekly lines from a real recording', () => {
    const reading = parseClaudeUsage(readFixture('claude-usage.json'), NOW);
    expect(reading.state).toBe('ok');
    expect(reading.buckets).toEqual([
      {
        group: null,
        window: 'five_hour',
        windowLabel: '5 giờ',
        remainingPercent: 73,
        resetsAt: '2026-11-11T16:59:00.000Z',
        appliesToModels: null,
      },
      {
        group: 'Tất cả model',
        window: 'weekly',
        windowLabel: 'tuần',
        remainingPercent: 95,
        resetsAt: '2026-11-18T11:59:00.000Z',
        appliesToModels: null,
      },
      {
        group: 'Fable',
        window: 'weekly',
        windowLabel: 'tuần',
        remainingPercent: 100,
        resetsAt: '2026-11-18T12:00:00.000Z',
        appliesToModels: ['fable'],
      },
    ]);
  });

  it('never invents numbers', () => {
    expect(parseClaudeUsage('{"result":"Something new"}', NOW).state).toBe('unreadable');
    expect(
      parseClaudeUsage('{"result":"Current session: 140% used"}', NOW).buckets[0]?.remainingPercent,
    ).toBe(0);
    expect(parseClaudeUsage('garbage', NOW).state).toBe('unreadable');
  });

  it('classifies output without limit lines', () => {
    expect(parseClaudeUsage('{"result":"Using an API key via Console"}', NOW).state).toBe(
      'not_applicable',
    );
    expect(parseClaudeUsage('{"result":"Please log in"}', NOW).state).toBe('not_signed_in');
  });
});

describe('parseClaudeResetTime', () => {
  it('rolls reset dates over midnight and the new year', () => {
    expect(parseClaudeResetTime('Nov 12, 12:30am (Asia/Ho_Chi_Minh)', NOW)).toBe(
      '2026-11-11T17:30:00.000Z',
    );
    expect(parseClaudeResetTime('Jan 2, 9am (UTC)', new Date('2026-12-30T00:00:00Z'))).toBe(
      '2027-01-02T09:00:00.000Z',
    );
    expect(parseClaudeResetTime('Nov 18, 7pm (America/New_York)', NOW)).toBe(
      '2026-11-19T00:00:00.000Z',
    );
    expect(parseClaudeResetTime('Nov 18, 7pm (Mars/Base)', NOW)).toBeNull();
  });

  it('never rolls a reset that just passed into next year', () => {
    // 23:26 in Ho Chi Minh: read two minutes after the reset.
    expect(parseClaudeResetTime('Nov 11, 11:26pm (Asia/Ho_Chi_Minh)', NOW)).toBeNull();
    expect(parseClaudeResetTime('Jan 2, 9am (UTC)', new Date('2026-12-30T00:00:00Z'))).toBe(
      '2027-01-02T09:00:00.000Z',
    );
    expect(parseClaudeResetTime('Jan 20, 9am (UTC)', new Date('2026-12-30T00:00:00Z'))).toBeNull();
  });
});
