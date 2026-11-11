import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_QUOTA_REQUEST_LINES, parseCodexRateLimitLine } from './cli-codex-quota.reader';

function readFixtureLines(fixtureName: string): string[] {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', fixtureName), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

describe('parseCodexRateLimitLine', () => {
  it('keeps the fixture a valid recording', () => {
    const lines = readFixtureLines('codex-rate-limits.jsonl');
    expect(() => lines.forEach((line) => JSON.parse(line))).not.toThrow();
  });

  it('reads primary and secondary windows from a real recording', () => {
    const readings = readFixtureLines('codex-rate-limits.jsonl')
      .map(parseCodexRateLimitLine)
      .filter(Boolean);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toEqual({
      state: 'ok',
      buckets: [
        {
          group: 'codex',
          window: 'five_hour',
          windowLabel: '5 giờ',
          remainingPercent: 100,
          resetsAt: new Date(1794433541 * 1000).toISOString(),
          appliesToModels: null,
        },
        {
          group: 'codex',
          window: 'weekly',
          windowLabel: 'tuần',
          remainingPercent: 97,
          resetsAt: new Date(1794446113 * 1000).toISOString(),
          appliesToModels: null,
        },
      ],
    });
  });

  it('treats a reached limit as exhausted', () => {
    const line = JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          limitId: 'codex',
          rateLimitReachedType: 'rate_limit_reached',
          primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 1794433541 },
          secondary: null,
        },
        rateLimitsByLimitId: null,
      },
    });
    expect(parseCodexRateLimitLine(line)?.buckets[0]?.remainingPercent).toBe(0);
  });

  it('maps a broken login to not_signed_in', () => {
    const line =
      '{"id":2,"error":{"code":-32603,"message":"failed to fetch codex rate limits: 401 Unauthorized"}}';
    expect(parseCodexRateLimitLine(line)?.state).toBe('not_signed_in');
  });

  it('reports other errors and odd shapes as unreadable', () => {
    expect(parseCodexRateLimitLine('{"id":2,"error":{"message":"boom"}}')?.state).toBe(
      'unreadable',
    );
    expect(parseCodexRateLimitLine('{"id":2,"result":{"rateLimits":"x"}}')?.state).toBe(
      'unreadable',
    );
  });

  it('reports not_applicable when there are no windows, and labels odd windows', () => {
    const empty = '{"id":2,"result":{"rateLimits":{"limitId":"codex"},"rateLimitsByLimitId":null}}';
    expect(parseCodexRateLimitLine(empty)?.state).toBe('not_applicable');
    const odd = JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          limitId: 'x',
          limitName: 'Named',
          primary: { usedPercent: 10, windowDurationMins: 120, resetsAt: 1 },
          secondary: { usedPercent: 10, windowDurationMins: 2880, resetsAt: 1 },
        },
      },
    });
    const buckets = parseCodexRateLimitLine(odd)?.buckets;
    expect(buckets?.map((bucket) => [bucket.group, bucket.window, bucket.windowLabel])).toEqual([
      ['Named', 'other', '2 giờ'],
      ['Named', 'other', '2 ngày'],
    ]);
  });

  it('falls back to rateLimits when rateLimitsByLimitId is empty', () => {
    const line = JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1794433541 },
        },
        rateLimitsByLimitId: {},
      },
    });
    expect(parseCodexRateLimitLine(line)?.buckets[0]?.remainingPercent).toBe(90);
  });

  it('ignores other lines', () => {
    expect(parseCodexRateLimitLine('{"id":1,"result":{}}')).toBeNull();
    expect(parseCodexRateLimitLine('not json')).toBeNull();
    expect(parseCodexRateLimitLine('{"method":"x"}')).toBeNull();
  });
});

describe('CODEX_QUOTA_REQUEST_LINES', () => {
  it('sends initialize, initialized, then the rate limit request', () => {
    expect(CODEX_QUOTA_REQUEST_LINES).toHaveLength(3);
    const [initialize, initialized, request] = CODEX_QUOTA_REQUEST_LINES.map((line) =>
      JSON.parse(line),
    );
    expect(initialize.method).toBe('initialize');
    expect(initialize.params.clientInfo.name).toBe('aiteam');
    expect(initialized).toEqual({ method: 'initialized' });
    expect(request).toEqual({ id: 2, method: 'account/rateLimits/read' });
  });
});
