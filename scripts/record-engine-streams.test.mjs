import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { buildQuotaFixtureText, readOneShot } from './record-engine-streams.mjs';

const CLAUDE_USAGE = JSON.stringify({
  type: 'result',
  local_command: 'usage',
  result:
    "Current session: 27% used · resets Nov 11, 11:59pm (UTC)\n\nWhat's contributing to your usage?\nTop skills: /secret 2%",
});

describe('buildQuotaFixtureText', () => {
  it('keeps the JSON lines and only the limit part of the Claude /usage text', () => {
    const fixture = buildQuotaFixtureText('claude-usage.json', `progress…\n${CLAUDE_USAGE}\n`);
    expect(fixture).not.toBeNull();
    expect(fixture).not.toContain('progress');
    expect(fixture).not.toContain('contributing');
    expect(JSON.parse(fixture ?? '').result).toBe(
      'Current session: 27% used · resets Nov 11, 11:59pm (UTC)',
    );
  });

  it('refuses output without a parseable JSON line', () => {
    expect(buildQuotaFixtureText('claude-usage.json', '')).toBeNull();
    expect(buildQuotaFixtureText('antigravity-usage.json', 'error: {not json\n')).toBeNull();
  });

  it('refuses a Codex recording without the answer to request 2', () => {
    const initialize = JSON.stringify({ id: 1, result: {} });
    expect(buildQuotaFixtureText('codex-rate-limits.jsonl', `${initialize}\n`)).toBeNull();
    const answer = JSON.stringify({ id: 2, result: { rateLimits: null } });
    expect(buildQuotaFixtureText('codex-rate-limits.jsonl', `${initialize}\n${answer}\n`)).toBe(
      `${initialize}\n${answer}\n`,
    );
  });
});

describe('readOneShot', () => {
  it('reports a CLI that cannot start with a fixed message instead of crashing', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((message) => errors.push(message));
    try {
      await expect(readOneShot('aiteam-no-such-cli', [], tmpdir())).resolves.toBe('');
    } finally {
      spy.mockRestore();
    }
    expect(errors).toEqual(['aiteam-no-such-cli: could not start (ENOENT); is it installed?']);
  });
});
