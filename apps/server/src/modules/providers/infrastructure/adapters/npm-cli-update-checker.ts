import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliUpdateNotice } from '@aiteam/contracts';
import { z } from 'zod';
import type {
  CliUpdateChecker,
  NpmPublishedEngine,
} from '../../application/ports/cli-update-checker.port';
import { AppError } from '../../../../shared/errors/app-error';
import type { AppLogger } from '../../../../shared/logging/app-logger';
import { resolveCliExecutable } from './engines/cli-process';
import { prepareQuotaProbeDirectory } from './quota/quota-probe-directory';

const runExecutable = promisify(execFile);
const VERSION_TIMEOUT_MS = 20_000;
const REGISTRY_TIMEOUT_MS = 10_000;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const RELEASE_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILED_RELEASE_CACHE_MS = 60 * 60 * 1000;
const INSTALLED_VERSION_CACHE_MS = 60 * 1000;

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

/** Fetches a URL; injectable so tests never reach the network. */
export type RegistryFetch = (url: string, init: RequestInit) => Promise<Response>;
/** Runs `<cli> --version`; injectable so tests never run a real CLI. Null when the CLI is missing. */
export type InstalledVersionReader = (executableName: string) => Promise<string | null>;

/**
 * Compares `<cli> --version` with the newest release on registry.npmjs.org. Only the package name
 * is sent (no token, no user detail); the newest version is remembered for 24 hours (1 hour after
 * a failure, which shows no notice), the installed one for a minute.
 */
export class NpmCliUpdateChecker implements CliUpdateChecker {
  private readonly latestReleases = new Map<string, CachedValue<Version | null>>();
  private readonly installedVersions = new Map<string, CachedValue<string | null>>();
  private readonly fetchRegistry: RegistryFetch;
  private readonly readInstalledVersion: InstalledVersionReader;

  constructor(
    private readonly dataDirectory: string,
    private readonly logger: AppLogger,
    overrides: {
      fetchRegistry?: RegistryFetch;
      readInstalledVersion?: InstalledVersionReader;
    } = {},
  ) {
    this.fetchRegistry = overrides.fetchRegistry ?? ((url, init) => fetch(url, init));
    this.readInstalledVersion =
      overrides.readInstalledVersion ??
      ((executableName) => this.readCliVersionOutput(executableName));
  }

  async findCliUpdate(engine: NpmPublishedEngine): Promise<CliUpdateNotice | null> {
    const { executableName, packageName, updateCommand } = CLI_PACKAGES[engine];
    const [installedOutput, latest] = await Promise.all([
      rememberFor(this.installedVersions, executableName, INSTALLED_VERSION_CACHE_MS, () =>
        this.readInstalledVersion(executableName),
      ),
      rememberFor(this.latestReleases, packageName, RELEASE_CACHE_MS, () =>
        this.fetchLatestRelease(packageName),
      ),
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
      if (!response.ok) {
        await response.body?.cancel();
        this.logger.warn({ packageName, status: response.status }, 'npm registry check refused');
        return null;
      }
      const body = await readBodyWithin(response, REGISTRY_MAX_BYTES);
      const manifest =
        body === null ? null : latestManifestSchema.safeParse(JSON.parse(body) as unknown);
      if (manifest === null || !manifest.success) {
        this.logger.warn({ packageName }, 'npm registry check: unexpected answer');
        return null;
      }
      return parseVersion(manifest.data.version);
    } catch (error) {
      // Offline, blocked or malformed: no notice (the model list still works). Never the body.
      this.logger.warn({ packageName, errorName: errorNameOf(error) }, 'npm registry check failed');
      return null;
    }
  }

  /** `<cli> --version`, e.g. "codex-cli 0.167.2" or "2.1.322 (Claude Code)"; null when it fails. */
  private async readCliVersionOutput(executableName: string): Promise<string | null> {
    try {
      const executable = resolveCliExecutable(executableName);
      const { stdout } = await runExecutable(
        executable.command,
        [...executable.leadingArgs, '--version'],
        {
          cwd: await prepareQuotaProbeDirectory(this.dataDirectory),
          timeout: VERSION_TIMEOUT_MS,
          windowsHide: true,
          encoding: 'utf8',
        },
      );
      return stdout;
    } catch (error) {
      // A missing CLI is reported by the engine card; anything else is worth a log line.
      if (!(error instanceof AppError && error.code === 'ENGINE_NOT_INSTALLED')) {
        this.logger.warn({ executableName, errorName: errorNameOf(error) }, 'cli --version failed');
      }
      return null;
    }
  }
}

interface CachedValue<Value> {
  expiresAt: number;
  value: Promise<Value>;
}

/** One read per key and window; a null result is kept only for the shorter failure window. */
function rememberFor<Value>(
  cache: Map<string, CachedValue<Value | null>>,
  key: string,
  windowMs: number,
  readValue: () => Promise<Value | null>,
): Promise<Value | null> {
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
  const entry: CachedValue<Value | null> = {
    expiresAt: Date.now() + windowMs,
    value: Promise.resolve(null),
  };
  entry.value = readValue().then((value) => {
    if (value === null) entry.expiresAt = Date.now() + Math.min(windowMs, FAILED_RELEASE_CACHE_MS);
    return value;
  });
  cache.set(key, entry);
  return entry.value;
}

/** The body as text, or null past `maxBytes` (stops reading there, whatever the server claims). */
async function readBodyWithin(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
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
