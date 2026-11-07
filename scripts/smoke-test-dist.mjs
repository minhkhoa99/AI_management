#!/usr/bin/env node
// Starts the bundled server from dist/ against a throwaway data directory and checks that
// /api/health answers, the UI is served, the session link sets the cookie and the API accepts
// the cookie but rejects calls without it.
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

const sessionToken = randomBytes(32).toString('base64url');
const runningServer = await startAiteamServer({
  preferredPort: 4399,
  version: '0.0.0-smoke',
  sessionToken,
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
    'API call without session cookie is rejected',
  );

  const exchangeResponse = await fetch(`${runningServer.baseUrl}/?session=${sessionToken}`, {
    redirect: 'manual',
  });
  const sessionCookie = (exchangeResponse.headers.get('set-cookie') ?? '').split(';')[0];
  assertSmokeExpectation(
    exchangeResponse.status === 303 &&
      exchangeResponse.headers.get('location') === '/' &&
      sessionCookie.startsWith('aiteam_session='),
    'session link sets the cookie and redirects to /',
  );

  const authorisedResponse = await fetch(`${runningServer.baseUrl}/api/departments`, {
    headers: { cookie: sessionCookie },
  });
  assertSmokeExpectation(
    authorisedResponse.status === 200 && Array.isArray(await authorisedResponse.json()),
    'GET /api/departments with session cookie returns the department list',
  );
  assertSmokeExpectation(
    runningServer.appliedMigrationVersions.join(',') === '1,2,3,4,5,6,7,8',
    'migrations 001-008 applied on a fresh database',
  );
} finally {
  await runningServer.stopServer();
  rmSync(aiteamHome, { recursive: true, force: true });
}
