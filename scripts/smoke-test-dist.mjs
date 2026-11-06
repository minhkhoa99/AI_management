#!/usr/bin/env node
// Starts the bundled server from dist/ against a throwaway data directory and checks that
// /api/health answers, the UI is served and the API rejects calls without the session token.
// Unit tests run TypeScript sources through SWC; this proves the esbuild bundle itself works
// (decorator metadata, lazy requires, static files).
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiteamHome = mkdtempSync(path.join(tmpdir(), 'aiteam-smoke-'));
const { startAiteamServer } = createRequire(import.meta.url)(
  path.join(repositoryRoot, 'dist', 'server', 'aiteam-server.cjs'),
);

function assertSmokeExpectation(condition, description) {
  if (!condition) {
    throw new Error(`smoke test failed: ${description}`);
  }
  console.log(`ok  ${description}`);
}

const runningServer = await startAiteamServer({
  port: 4399,
  version: '0.0.0-smoke',
  sessionToken: randomBytes(32).toString('base64url'),
  dataDirectory: path.join(aiteamHome, 'data'),
  logDirectory: path.join(aiteamHome, 'logs'),
  webRootDirectory: path.join(repositoryRoot, 'dist', 'web'),
});

try {
  const healthResponse = await fetch(`${runningServer.baseUrl}/api/health`);
  const healthBody = await healthResponse.json();
  assertSmokeExpectation(
    healthResponse.status === 200 && healthBody.status === 'ok',
    'GET /api/health returns ok',
  );

  const pageResponse = await fetch(`${runningServer.baseUrl}/org/`);
  const pageHtml = await pageResponse.text();
  assertSmokeExpectation(
    pageResponse.status === 200 && pageHtml.includes('Điều hướng chính'),
    'GET /org/ serves the page with the sidebar',
  );

  const unauthorisedResponse = await fetch(`${runningServer.baseUrl}/api/departments`);
  assertSmokeExpectation(
    unauthorisedResponse.status === 403,
    'API call without session token is rejected',
  );
  assertSmokeExpectation(
    runningServer.appliedMigrationVersions.includes(1),
    'migration 001 applied on a fresh database',
  );
} finally {
  await runningServer.stopServer();
  rmSync(aiteamHome, { recursive: true, force: true });
}
