#!/usr/bin/env node
// Measures the resource targets of the plan (section 1) on the built app:
//   - startup: launcher spawn → /api/health answers, < 2 s (first start on a fresh data
//     directory, which also runs every migration, and warm restarts on the same directory);
//   - idle memory: resident set size of the server process after it sits idle with the UI open
//     (session cookie, the Overview's API calls and the workspace live stream), < 150 MB;
//   - install size: unpacked size of the npm package (bin + dist), < 15 MB.
// Runs `node bin/aiteam.mjs --no-open` exactly as the installed command does, against a
// throwaway AITEAM_HOME. Exits 1 when a target is missed. Needs `npm run build` first.
// Usage: node scripts/measure-runtime.mjs [--runs 3] [--idle-seconds 10] [--json]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcherPath = path.join(repositoryRoot, 'bin', 'aiteam.mjs');
const STARTUP_TARGET_MS = 2_000;
const IDLE_MEMORY_TARGET_BYTES = 150 * 1024 * 1024;
const PACKAGE_SIZE_TARGET_BYTES = 15 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 30_000;
const PACKAGED_PATHS = ['bin/aiteam.mjs', 'bin/node-version-policy.mjs', 'dist'];
/** What the Overview page loads; replayed before the idle period so memory reflects an open UI. */
const UI_PAGE_PATHS = ['/', '/org/'];
const UI_API_PATHS = [
  '/api/departments',
  '/api/overview/metrics',
  '/api/overview/throughput',
  '/api/overview/usage-by-provider',
  '/api/overview/usage-today',
  '/api/activity',
];
const UI_STREAM_PATH = '/api/stream/workspace';

const { values: options } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    'idle-seconds': { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
  },
});
const runCount = Math.max(1, Number(options.runs));
const idleSeconds = Math.max(0, Number(options['idle-seconds']));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealth(baseUrl, serverProcess) {
  const deadline = performance.now() + STARTUP_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`server exited with code ${serverProcess.exitCode} before answering`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet: keep polling until the deadline.
    }
    await pause(20);
  }
  throw new Error(`server did not answer /api/health within ${STARTUP_TIMEOUT_MS} ms`);
}

/** Resident set size in bytes (working set on Windows). */
function readResidentMemory(pid) {
  if (process.platform === 'win32') {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
      { encoding: 'utf8' },
    );
    return Number(output.trim());
  }
  const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  return Number(output.trim()) * 1024;
}

/**
 * Acts like the browser opening the printed link: swaps the session token for the cookie, loads
 * the Overview and its API calls, and keeps the workspace live stream open. Returns a function
 * that closes the stream (called after the idle measurement).
 */
async function openUserInterface(baseUrl, launcherOutput) {
  const sessionQuery = /\?(session=[\w-]+)/.exec(launcherOutput)?.[1];
  if (sessionQuery === undefined) {
    throw new Error('launcher did not print the session link');
  }
  const exchange = await fetch(`${baseUrl}/?${sessionQuery}`, { redirect: 'manual' });
  const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
  if (cookie === undefined) {
    throw new Error(`session exchange returned ${exchange.status} without a cookie`);
  }
  const headers = { cookie };
  for (const pagePath of [...UI_PAGE_PATHS, ...UI_API_PATHS]) {
    const response = await fetch(`${baseUrl}${pagePath}`, { headers });
    if (!response.ok) {
      throw new Error(`GET ${pagePath} returned ${response.status}`);
    }
    await response.arrayBuffer();
  }
  const stream = await fetch(`${baseUrl}${UI_STREAM_PATH}`, {
    headers: { ...headers, accept: 'text/event-stream' },
  });
  if (!stream.ok) {
    throw new Error(`GET ${UI_STREAM_PATH} returned ${stream.status}`);
  }
  // Read in the background like EventSource until the stream is closed.
  const reader = stream.body.getReader();
  const drainStream = async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      // Updates are not inspected: only the open connection matters.
    }
  };
  const draining = drainStream();
  return async () => {
    await reader.cancel();
    await draining;
  };
}

function stopServerProcess(serverProcess) {
  return new Promise((resolve) => {
    if (serverProcess.exitCode !== null) {
      resolve();
      return;
    }
    serverProcess.once('exit', () => resolve());
    serverProcess.kill('SIGTERM');
  });
}

async function measureStart(aiteamHome, { measureIdleMemory }) {
  const port = await findFreePort();
  const startedAt = performance.now();
  const serverProcess = spawn(
    process.execPath,
    [launcherPath, '--no-open', '--port', String(port)],
    {
      env: { ...process.env, AITEAM_HOME: aiteamHome, AITEAM_PORT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let launcherOutput = '';
  serverProcess.stdout.on('data', (chunk) => (launcherOutput += chunk));
  serverProcess.stderr.on('data', (chunk) => (launcherOutput += chunk));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, serverProcess);
    const startupMs = Math.round(performance.now() - startedAt);
    const reportedReadyMs = Number(/Sẵn sàng sau (\d+) ms/.exec(launcherOutput)?.[1] ?? NaN);
    let idleMemoryBytes = null;
    if (measureIdleMemory) {
      const closeUserInterface = await openUserInterface(baseUrl, launcherOutput);
      await pause(idleSeconds * 1_000);
      idleMemoryBytes = readResidentMemory(serverProcess.pid);
      await closeUserInterface();
    }
    return { startupMs, reportedReadyMs, idleMemoryBytes };
  } catch (error) {
    // The session token is in the launcher output: never print it.
    throw new Error(
      `${error.message}\n${launcherOutput.replace(/session=[\w-]+/g, 'session=***')}`,
      { cause: error },
    );
  } finally {
    await stopServerProcess(serverProcess);
  }
}

function measureDirectorySize(entryPath) {
  const entry = statSync(entryPath);
  if (!entry.isDirectory()) {
    return entry.size;
  }
  return readdirSync(entryPath).reduce(
    (total, name) => total + measureDirectorySize(path.join(entryPath, name)),
    0,
  );
}

function median(numbers) {
  const sorted = [...numbers].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

if (!existsSync(path.join(repositoryRoot, 'dist', 'server', 'aiteam-server.cjs'))) {
  console.error('dist/ is missing: run "npm run build" first.');
  process.exit(1);
}

const aiteamHome = mkdtempSync(path.join(tmpdir(), 'aiteam-measure-'));
try {
  const firstStart = await measureStart(aiteamHome, { measureIdleMemory: false });
  const warmStarts = [];
  for (let index = 0; index < runCount; index += 1) {
    warmStarts.push(await measureStart(aiteamHome, { measureIdleMemory: index === runCount - 1 }));
  }
  const packageSizeBytes = PACKAGED_PATHS.reduce(
    (total, relativePath) => total + measureDirectorySize(path.join(repositoryRoot, relativePath)),
    0,
  );

  const warmStartupMs = median(warmStarts.map((start) => start.startupMs));
  const idleMemoryBytes = warmStarts.at(-1).idleMemoryBytes;
  const results = [
    {
      metric: 'first start (fresh data, migrations)',
      value: `${firstStart.startupMs} ms`,
      target: `< ${STARTUP_TARGET_MS} ms`,
      passed: firstStart.startupMs < STARTUP_TARGET_MS,
    },
    {
      metric: `warm start (median of ${runCount})`,
      value: `${warmStartupMs} ms`,
      target: `< ${STARTUP_TARGET_MS} ms`,
      passed: warmStartupMs < STARTUP_TARGET_MS,
    },
    {
      metric: `idle memory (UI open, RSS after ${idleSeconds} s)`,
      value: formatMegabytes(idleMemoryBytes),
      target: `< ${formatMegabytes(IDLE_MEMORY_TARGET_BYTES)}`,
      passed: idleMemoryBytes < IDLE_MEMORY_TARGET_BYTES,
    },
    {
      metric: 'package size (bin + dist, unpacked)',
      value: formatMegabytes(packageSizeBytes),
      target: `< ${formatMegabytes(PACKAGE_SIZE_TARGET_BYTES)}`,
      passed: packageSizeBytes < PACKAGE_SIZE_TARGET_BYTES,
    },
  ];

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          firstStart,
          warmStarts,
          packageSizeBytes,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Node ${process.version} on ${process.platform}`);
    for (const result of results) {
      console.log(
        `${result.passed ? 'ok  ' : 'FAIL'}  ${result.metric.padEnd(40)} ${result.value.padStart(10)}  (${result.target})`,
      );
    }
    const readyTimes = [firstStart, ...warmStarts].map((start) => start.reportedReadyMs);
    console.log(`      launcher-reported ready times: ${readyTimes.join(', ')} ms`);
  }
  process.exitCode = results.every((result) => result.passed) ? 0 : 1;
} finally {
  rmSync(aiteamHome, { recursive: true, force: true });
}
