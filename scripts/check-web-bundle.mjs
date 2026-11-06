#!/usr/bin/env node
// Web bundle budget (docs/IMPLEMENTATION_PLAN.md 5.10), gzip, per route, first load:
//   - framework chunks (Next/React/Turbopack runtime = build-manifest rootMainFiles):
//     at most +10% over the baseline in scripts/web-bundle-baseline.json
//   - application code (every other script the route's HTML loads): <= 70 KB
//   - total first-load JavaScript: <= 230 KB
// noModule polyfills are not loaded by current browsers and are reported separately.
//
//   node scripts/check-web-bundle.mjs                  # check (CI)
//   node scripts/check-web-bundle.mjs --update-baseline  # record the framework size after a Next/React upgrade
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KILOBYTE = 1024;
const APP_CODE_BUDGET_BYTES = 70 * KILOBYTE;
const TOTAL_BUDGET_BYTES = 230 * KILOBYTE;
const FRAMEWORK_GROWTH_LIMIT = 1.1;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repositoryRoot, 'dist', 'web');
const buildManifestPath = path.join(repositoryRoot, 'apps', 'web', '.next', 'build-manifest.json');
const baselinePath = path.join(repositoryRoot, 'scripts', 'web-bundle-baseline.json');

function listRouteHtmlFiles(directory, relativeDirectory = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith('_')
        ? []
        : listRouteHtmlFiles(path.join(directory, entry.name), relativePath);
    }
    return entry.name === 'index.html' ? [relativePath] : [];
  });
}

function listLoadedScripts(html) {
  const scripts = new Set();
  for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
    const source = /\bsrc="([^"]+\.js)"/.exec(tag[0])?.[1];
    if (source !== undefined && !/\bnoModule\b/i.test(tag[0])) {
      scripts.add(source);
    }
  }
  return [...scripts];
}

function measureGzipBytes(scriptSource, cache) {
  if (!cache.has(scriptSource)) {
    cache.set(scriptSource, gzipSync(readFileSync(path.join(webRoot, scriptSource))).length);
  }
  return cache.get(scriptSource);
}

function formatKilobytes(bytes) {
  return `${(bytes / KILOBYTE).toFixed(1)} KB`;
}

if (!existsSync(webRoot) || !existsSync(buildManifestPath)) {
  console.error(
    'check-web-bundle: run "npm run build" first (dist/web and apps/web/.next are needed).',
  );
  process.exit(1);
}

const buildManifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
const frameworkScripts = new Set(buildManifest.rootMainFiles.map((file) => `/_next/${file}`));
const sizeCache = new Map();

const routes = listRouteHtmlFiles(webRoot).map((htmlFile) => {
  const scripts = listLoadedScripts(readFileSync(path.join(webRoot, htmlFile), 'utf8'));
  const frameworkBytes = scripts
    .filter((source) => frameworkScripts.has(source))
    .reduce((sum, source) => sum + measureGzipBytes(source, sizeCache), 0);
  const appBytes = scripts
    .filter((source) => !frameworkScripts.has(source))
    .reduce((sum, source) => sum + measureGzipBytes(source, sizeCache), 0);
  const route = `/${htmlFile.replace(/index\.html$/, '')}`;
  return { route, frameworkBytes, appBytes, totalBytes: frameworkBytes + appBytes };
});

const frameworkBytes = Math.max(...routes.map((route) => route.frameworkBytes));

if (process.argv.includes('--update-baseline')) {
  const nextVersion = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'node_modules', 'next', 'package.json'), 'utf8'),
  ).version;
  const reactVersion = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'node_modules', 'react', 'package.json'), 'utf8'),
  ).version;
  const baseline = {
    frameworkGzipBytes: frameworkBytes,
    next: nextVersion,
    react: reactVersion,
    measuredOn: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Baseline updated: framework ${formatKilobytes(frameworkBytes)} (next ${nextVersion}, react ${reactVersion}).`,
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const frameworkLimit = Math.round(baseline.frameworkGzipBytes * FRAMEWORK_GROWTH_LIMIT);
const failures = [];

console.log('route'.padEnd(14), 'framework'.padStart(11), 'app'.padStart(10), 'total'.padStart(10));
for (const route of routes.sort((left, right) => left.route.localeCompare(right.route))) {
  console.log(
    route.route.padEnd(14),
    formatKilobytes(route.frameworkBytes).padStart(11),
    formatKilobytes(route.appBytes).padStart(10),
    formatKilobytes(route.totalBytes).padStart(10),
  );
  if (route.appBytes > APP_CODE_BUDGET_BYTES) {
    failures.push(
      `${route.route}: application code ${formatKilobytes(route.appBytes)} > ${formatKilobytes(APP_CODE_BUDGET_BYTES)}`,
    );
  }
  if (route.totalBytes > TOTAL_BUDGET_BYTES) {
    failures.push(
      `${route.route}: first load ${formatKilobytes(route.totalBytes)} > ${formatKilobytes(TOTAL_BUDGET_BYTES)}`,
    );
  }
}
console.log(
  `framework baseline ${formatKilobytes(baseline.frameworkGzipBytes)} (limit ${formatKilobytes(frameworkLimit)}, next ${baseline.next})`,
);
if (frameworkBytes > frameworkLimit) {
  failures.push(
    `framework ${formatKilobytes(frameworkBytes)} grew more than 10% over the baseline ${formatKilobytes(baseline.frameworkGzipBytes)}`,
  );
}

if (failures.length > 0) {
  console.error(`\nWeb bundle budget exceeded:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('Web bundle budget OK.');
