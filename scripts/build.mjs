#!/usr/bin/env node
// Builds the distributable app into dist/:
//   dist/server/aiteam-server.cjs  NestJS server bundled into one file (no node_modules needed)
//   dist/web/                      static Next.js export served by the server
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform as transformWithSwc } from '@swc/core';
import { build as bundleWithEsbuild } from 'esbuild';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(repositoryRoot, 'dist');
const serverBundlePath = path.join(distDirectory, 'server', 'aiteam-server.cjs');
const webExportDirectory = path.join(repositoryRoot, 'apps', 'web', 'out');
const webDistDirectory = path.join(distDirectory, 'web');

/**
 * Optional NestJS / Fastify integrations loaded lazily inside try/catch. Not installed, never used:
 * leaving them external keeps esbuild from failing on the missing modules.
 */
const OPTIONAL_RUNTIME_MODULES = [
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  '@nestjs/websockets',
  '@nestjs/websockets/socket-module',
  '@nestjs/platform-express',
  '@fastify/view',
  '@fastify/multipart',
  'class-transformer',
  'class-transformer/storage',
  'class-validator',
];

/**
 * esbuild cannot emit `design:paramtypes` decorator metadata, which NestJS dependency injection
 * reads at runtime. SWC can, so TypeScript files are transpiled by SWC before esbuild bundles them.
 */
const swcDecoratorMetadataPlugin = {
  name: 'swc-decorator-metadata',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (loadArgs) => {
      const sourceCode = readFileSync(loadArgs.path, 'utf8');
      const transformed = await transformWithSwc(sourceCode, {
        filename: loadArgs.path,
        sourceMaps: false,
        module: { type: 'es6' },
        jsc: {
          target: 'es2023',
          parser: { syntax: 'typescript', decorators: true },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
            useDefineForClassFields: false,
          },
          keepClassNames: true,
        },
      });
      return { contents: transformed.code, loader: 'js' };
    });
  },
};

function measureDirectoryBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return (
      total + (entry.isDirectory() ? measureDirectoryBytes(entryPath) : statSync(entryPath).size)
    );
  }, 0);
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Next.js 16 static export names segment prefetch files `__next.<segment path with "/" → ".">.txt`,
 * but on Windows the segment path uses "\\" so the dots are not applied and the files land in
 * nested folders (`org/__next.org/__PAGE__.txt` instead of `org/__next.org.__PAGE__.txt`). The
 * client then gets 404 on prefetch. Move them to the flat names the client requests.
 * No-op on Linux/macOS builds.
 */
function flattenNestedSegmentPrefetchFiles(directory) {
  let flattenedCount = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (!entry.name.startsWith('__next.')) {
      flattenedCount += flattenNestedSegmentPrefetchFiles(entryPath);
      continue;
    }
    for (const nestedFile of readdirSync(entryPath, { recursive: true, withFileTypes: true })) {
      if (!nestedFile.isFile()) {
        continue;
      }
      const relativePath = path.relative(
        entryPath,
        path.join(nestedFile.parentPath, nestedFile.name),
      );
      const flatName = `${entry.name}.${relativePath.split(path.sep).join('.')}`;
      renameSync(path.join(nestedFile.parentPath, nestedFile.name), path.join(directory, flatName));
      flattenedCount += 1;
    }
    rmSync(entryPath, { recursive: true });
  }
  return flattenedCount;
}

async function bundleServer() {
  const startedAt = performance.now();
  await bundleWithEsbuild({
    entryPoints: [path.join(repositoryRoot, 'apps', 'server', 'src', 'main.ts')],
    outfile: serverBundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: true,
    // Nest uses class names for provider tokens and log contexts.
    keepNames: true,
    legalComments: 'none',
    external: OPTIONAL_RUNTIME_MODULES,
    plugins: [swcDecoratorMetadataPlugin],
    logLevel: 'warning',
  });
  console.log(
    `server bundle  ${formatMegabytes(statSync(serverBundlePath).size)}  (${Math.round(performance.now() - startedAt)} ms)`,
  );
}

function buildWeb() {
  const webDirectory = path.join(repositoryRoot, 'apps', 'web');
  // Run the Next.js CLI with the current node binary: no shell, no PATH lookup.
  const nextCliPath = createRequire(path.join(webDirectory, 'package.json')).resolve(
    'next/dist/bin/next',
  );
  const result = spawnSync(process.execPath, [nextCliPath, 'build'], {
    cwd: webDirectory,
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`web build failed with exit code ${result.status}`);
  }
  if (!existsSync(path.join(webExportDirectory, 'index.html'))) {
    throw new Error(`web build did not produce ${path.join(webExportDirectory, 'index.html')}`);
  }
  cpSync(webExportDirectory, webDistDirectory, { recursive: true });
  const flattenedCount = flattenNestedSegmentPrefetchFiles(webDistDirectory);
  if (flattenedCount > 0) {
    console.log(
      `web export     flattened ${flattenedCount} segment prefetch files (Windows path fix)`,
    );
  }
  console.log(`web export     ${formatMegabytes(measureDirectoryBytes(webDistDirectory))}`);
}

rmSync(distDirectory, { recursive: true, force: true });
await bundleServer();
buildWeb();
console.log(`dist total     ${formatMegabytes(measureDirectoryBytes(distDirectory))}`);
