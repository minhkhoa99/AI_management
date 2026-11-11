import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliUpdateNotice } from '@aiteam/contracts';
import { z } from 'zod';
import type {
  CliUpdateChecker,
  NpmPublishedEngine,
} from '../../application/ports/cli-update-checker.port';
import { resolveCliExecutable } from './engines/cli-process';

const runExecutable = promisify(execFile);
const VERSION_TIMEOUT_MS = 20_000;
const REGISTRY_TIMEOUT_MS = 10_000;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const RELEASE_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILED_RELEASE_CACHE_MS = 60 * 60 * 1000;

const CLI_PACKAGES: Record<
  NpmPublishedEngine,
  { executableName: string; packageName: string; updateCommand: string }
> = {
  claude_code: {
    executableName: 'claude',
    packageName: '@anthropic-ai/claude-code',
    updateCommand: 'claude update',
  },
  codex: {
    executableName: 'codex',
    packageName: '@openai/codex',
    updateCommand: 'npm i -g @openai/codex@latest',
  },
};

const latestManifestSchema = z.object({ version: z.string().max(64) });

type Version = readonly [number, number, number];

/** Fetches a URL's body as text; injectable so tests never reach the network. */
export type RegistryFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Compares `<cli> --version` with the newest release on registry.npmjs.org. Only the package name
 * is sent (no token, no user detail); the newest version is remembered for 24 hours (1 hour after
 * a failure, which shows no notice).
 */
export class NpmCliUpdateChecker implements CliUpdateChecker {
  private readonly latestReleases = new Map<
    string,
    { expiresAt: number; version: Promise<Version | null> }
  >();

  constructor(
    private readonly fetchRegistry: RegistryFetch = (url, init) => fetch(url, init),
    private readonly readInstalledVersion: (
      executableName: string,
    ) => Promise<string | null> = readCliVersionOutput,
  ) {}

  async findCliUpdate(engine: NpmPublishedEngine): Promise<CliUpdateNotice | null> {
    const { executableName, packageName, updateCommand } = CLI_PACKAGES[engine];
    const [installedOutput, latest] = await Promise.all([
      this.readInstalledVersion(executableName),
      this.readLatestRelease(packageName),
    ]);
    const installed = installedOutput === null ? null : parseVersion(installedOutput);
    if (installed === null || latest === null || compareVersions(installed, latest) >= 0) {
      return null;
    }
    return {
      installedVersion: installed.join('.'),
      latestVersion: latest.join('.'),
      updateCommand,
    };
  }

  private readLatestRelease(packageName: string): Promise<Version | null> {
    const cached = this.latestReleases.get(packageName);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.version;
    const entry: { expiresAt: number; version: Promise<Version | null> } = {
      expiresAt: Date.now() + RELEASE_CACHE_MS,
      version: Promise.resolve(null),
    };
    entry.version = this.fetchLatestRelease(packageName).then((version) => {
      if (version === null) entry.expiresAt = Date.now() + FAILED_RELEASE_CACHE_MS;
      return version;
    });
    this.latestReleases.set(packageName, entry);
    return entry.version;
  }

  private async fetchLatestRelease(packageName: string): Promise<Version | null> {
    try {
      const response = await this.fetchRegistry(
        `https://registry.npmjs.org/${packageName.replace('/', '%2F')}/latest`,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        },
      );
      if (!response.ok) return null;
      const body = await response.arrayBuffer();
      if (body.byteLength > REGISTRY_MAX_BYTES) return null;
      const manifest = latestManifestSchema.safeParse(
        JSON.parse(new TextDecoder().decode(body)) as unknown,
      );
      return manifest.success ? parseVersion(manifest.data.version) : null;
    } catch {
      // Offline, blocked or a malformed answer: no notice (the model list still works).
      return null;
    }
  }
}

/** `<cli> --version`, e.g. "codex-cli 0.167.2" or "2.1.322 (Claude Code)"; null when it fails. */
async function readCliVersionOutput(executableName: string): Promise<string | null> {
  try {
    const executable = resolveCliExecutable(executableName);
    const { stdout } = await runExecutable(
      executable.command,
      [...executable.leadingArgs, '--version'],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
    );
    return stdout;
  } catch {
    // Missing or broken CLI: the engine card already reports it; no update notice here.
    return null;
  }
}

/** The first `x.y.z` in the text (a pre-release suffix is ignored). */
export function parseVersion(text: string): Version | null {
  const match = /(\d{1,6})\.(\d{1,6})\.(\d{1,6})/.exec(text);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(first: Version, second: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
