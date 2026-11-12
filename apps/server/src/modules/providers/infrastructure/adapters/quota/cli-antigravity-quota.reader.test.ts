import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAntigravityUsage } from './cli-antigravity-quota.reader';

function readFixture(fixtureName: string): string {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', fixtureName), 'utf8');
}

describe('parseAntigravityUsage', () => {
  it('reads both groups from a real recording', () => {
    const reading = parseAntigravityUsage(readFixture('antigravity-usage.json'));
    expect(reading.state).toBe('ok');
    expect(reading.buckets).toHaveLength(4);
    expect(reading.buckets[0]).toEqual({
      group: 'Gemini Models',
      window: 'weekly',
      windowLabel: 'tuần',
      remainingPercent: 99,
      resetsAt: '2026-11-17T15:58:30.000Z',
      appliesToModels: ['gemini'],
    });
    expect(reading.buckets[1]?.window).toBe('five_hour');
    expect(reading.buckets[1]?.windowLabel).toBe('5 giờ');
    expect(reading.buckets[2]?.appliesToModels).toEqual(['claude', 'gpt-oss', 'gpt']);
  });

  it('reports unreadable output instead of throwing', () => {
    expect(parseAntigravityUsage('not json').state).toBe('unreadable');
    expect(parseAntigravityUsage('{"status":"SUCCESS","command":{"name":"usage"}}').state).toBe(
      'unreadable',
    );
  });

  it('cuts long group names and window labels instead of rejecting the engine', () => {
    const output = JSON.stringify({
      status: 'SUCCESS',
      command: {
        ['data']: {
          groups: [
            {
              name: 'G'.repeat(120),
              buckets: [{ window: 'w'.repeat(60), remaining_fraction: 0.5 }],
            },
          ],
        },
      },
    });
    const reading = parseAntigravityUsage(output);
    expect(reading.state).toBe('ok');
    expect(reading.buckets[0]?.group).toBe('G'.repeat(80));
    expect(reading.buckets[0]?.windowLabel).toBe('w'.repeat(40));
  });

  it('recognises a signed-out CLI', () => {
    expect(parseAntigravityUsage('error: authentication required').state).toBe('not_signed_in');
  });

  it('keeps an unknown window under the CLI wording and no models when undescribed', () => {
    const output = JSON.stringify({
      status: 'SUCCESS',
      command: {
        ['data']: {
          groups: [
            {
              name: 'G',
              buckets: [{ name: 'Daily Limit', window: 'daily', remaining_fraction: 0.5 }],
            },
          ],
        },
      },
    });
    const reading = parseAntigravityUsage(`progress line\n${output}\n`);
    expect(reading.buckets).toEqual([
      {
        group: 'G',
        window: 'other',
        windowLabel: 'daily',
        remainingPercent: 50,
        resetsAt: null,
        appliesToModels: null,
      },
    ]);
  });
});
