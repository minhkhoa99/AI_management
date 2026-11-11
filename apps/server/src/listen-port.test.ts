import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isPortAvailable,
  isPortUnusableError,
  listCandidatePorts,
  MAX_PORT_ATTEMPTS,
} from './listen-port';
import { LISTEN_HOST, startAiteamServer } from './main';

const occupiedServers: Server[] = [];
const temporaryDirectories: string[] = [];

function occupyPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blocker.once('error', reject);
    blocker.listen({ port, host: LISTEN_HOST }, () => resolve());
    occupiedServers.push(blocker);
  });
}

/** A port the OS just reported free, so concurrent test runs do not collide. */
function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({ port: 0, host: LISTEN_HOST }, () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address !== null ? address.port : 0),
      );
    });
  });
}

afterEach(async () => {
  await Promise.all(
    occupiedServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('listCandidatePorts', () => {
  it('starts at the preferred port and tries the next ones', () => {
    const candidates = listCandidatePorts(7419);

    expect(candidates[0]).toBe(7419);
    expect(candidates[1]).toBe(7420);
    expect(candidates).toHaveLength(MAX_PORT_ATTEMPTS);
  });

  it('never goes past 65535', () => {
    expect(listCandidatePorts(65_534)).toEqual([65_534, 65_535]);
  });
});

describe('isPortUnusableError', () => {
  // Regression: on Windows, ports inside a Hyper-V/WSL excluded range fail with EACCES.
  it.each([
    ['EADDRINUSE', true],
    ['EACCES', true],
    ['ECONNREFUSED', false],
    [undefined, false],
  ])('treats %s as unusable: %s', (code, expected) => {
    expect(isPortUnusableError(Object.assign(new Error('listen failed'), { code }))).toBe(expected);
  });
});

describe('isPortAvailable', () => {
  it('reports a busy port as unavailable and a free one as available', async () => {
    const port = await reserveEphemeralPort();
    expect(await isPortAvailable(port, LISTEN_HOST)).toBe(true);

    await occupyPort(port);
    expect(await isPortAvailable(port, LISTEN_HOST)).toBe(false);
  });
});

describe('startAiteamServer port selection', () => {
  it('falls back to the next free port and reports the real URL', async () => {
    const preferredPort = await reserveEphemeralPort();
    await occupyPort(preferredPort);
    const aiteamHome = mkdtempSync(path.join(tmpdir(), 'aiteam-port-'));
    temporaryDirectories.push(aiteamHome);

    const runningServer = await startAiteamServer({
      preferredPort,
      version: '0.0.0-test',
      sessionToken: randomBytes(32).toString('base64url'),
      dataDirectory: path.join(aiteamHome, 'data'),
      logDirectory: path.join(aiteamHome, 'logs'),
      logLevel: 'silent',
      // Booting with real adapters would spawn the engine CLIs in the data directory.
      localEngineAdaptersOverride: { quotaReaders: [] },
    });
    try {
      expect(runningServer.listenPort).toBeGreaterThan(preferredPort);
      expect(runningServer.baseUrl).toBe(`http://127.0.0.1:${runningServer.listenPort}`);

      // Host check follows the port actually bound.
      const health = await fetch(`${runningServer.baseUrl}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      await runningServer.stopServer();
    }
  });
});
