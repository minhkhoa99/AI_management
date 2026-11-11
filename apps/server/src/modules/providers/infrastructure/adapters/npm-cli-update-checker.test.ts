import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, NpmCliUpdateChecker, parseVersion } from './npm-cli-update-checker';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function buildChecker(
  fetchRegistry: (url: string, init: RequestInit) => Promise<Response>,
  installedOutput: string | null = 'codex-cli 0.155.1',
) {
  const fetchSpy = vi.fn(fetchRegistry);
  const checker = new NpmCliUpdateChecker(fetchSpy, () => Promise.resolve(installedOutput));
  return { checker, fetchSpy };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('NpmCliUpdateChecker', () => {
  it('reports an older installed CLI with the command that updates it', async () => {
    const { checker, fetchSpy } = buildChecker(() =>
      Promise.resolve(jsonResponse({ version: '0.167.2', name: '@openai/codex' })),
    );
    expect(await checker.findCliUpdate('codex')).toEqual({
      installedVersion: '0.155.1',
      latestVersion: '0.167.2',
      updateCommand: 'npm i -g @openai/codex@latest',
    });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://registry.npmjs.org/@openai%2Fcodex/latest');
    expect(init?.redirect).toBe('error');
  });

  it('reports nothing when the CLI is current or newer', async () => {
    const { checker } = buildChecker(
      () => Promise.resolve(jsonResponse({ version: '2.1.322' })),
      '2.1.322 (Claude Code)',
    );
    expect(await checker.findCliUpdate('claude_code')).toBeNull();
  });

  it('reports nothing when the CLI is missing, the registry fails or answers nonsense', async () => {
    expect(
      await buildChecker(
        () => Promise.resolve(jsonResponse({ version: '9.9.9' })),
        null,
      ).checker.findCliUpdate('codex'),
    ).toBeNull();
    expect(
      await buildChecker(() => Promise.reject(new Error('offline'))).checker.findCliUpdate('codex'),
    ).toBeNull();
    expect(
      await buildChecker(() => Promise.resolve(jsonResponse({}, 404))).checker.findCliUpdate(
        'codex',
      ),
    ).toBeNull();
    expect(
      await buildChecker(() => Promise.resolve(new Response('<html>'))).checker.findCliUpdate(
        'codex',
      ),
    ).toBeNull();
  });

  it('asks the registry once a day, and again after an hour when it failed', async () => {
    vi.useFakeTimers();
    const { checker, fetchSpy } = buildChecker(() =>
      Promise.resolve(jsonResponse({ version: '0.167.2' })),
    );
    await checker.findCliUpdate('codex');
    await checker.findCliUpdate('codex');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await checker.findCliUpdate('codex');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const failing = buildChecker(() => Promise.reject(new Error('offline')));
    await failing.checker.findCliUpdate('codex');
    vi.advanceTimersByTime(30 * 60 * 1000);
    await failing.checker.findCliUpdate('codex');
    expect(failing.fetchSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    await failing.checker.findCliUpdate('codex');
    expect(failing.fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('version helpers', () => {
  it('reads the first x.y.z of a --version line', () => {
    expect(parseVersion('codex-cli 0.167.2')).toEqual([0, 167, 2]);
    expect(parseVersion('2.1.322 (Claude Code)')).toEqual([2, 1, 322]);
    expect(parseVersion('1.2.3-beta.4')).toEqual([1, 2, 3]);
    expect(parseVersion('unknown')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([0, 155, 1], [0, 167, 2])).toBeLessThan(0);
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});
