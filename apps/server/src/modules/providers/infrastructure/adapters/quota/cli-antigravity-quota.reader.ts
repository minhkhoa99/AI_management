import { z } from 'zod';
import {
  type EngineQuotaBucket,
  engineQuotaBucketSchema,
  truncateQuotaGroup,
  truncateQuotaWindowLabel,
} from '@aiteam/contracts';
import { AppError } from '../../../../../shared/errors/app-error';
import type {
  EngineQuotaReader,
  EngineQuotaReading,
} from '../../../application/ports/engine-quota-reader.port';
import { clearEngineManagedPaths } from '../engines/antigravity-workspace-guard';
import { resolveCliExecutable } from '../engines/cli-process';
import { readQuotaCommandOutput } from './quota-command';
import { prepareQuotaProbeDirectory } from './quota-probe-directory';

const MODELS_PREFIX = 'Models within this group:';
const SIGNED_OUT_PATTERN = /authentication required|sign in|not logged in|unauthori[sz]ed|\b401\b/i;

const usageBucketSchema = z.object({
  name: z.string().optional(),
  window: z.string(),
  remaining_fraction: z.number(),
  reset_time: z.string().nullish(),
});
const usageGroupSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  buckets: z.array(usageBucketSchema),
});
const usageOutputSchema = z.object({
  status: z.string(),
  command: z.object({ ['data']: z.object({ groups: z.array(usageGroupSchema) }) }),
});

/** Reads `agy -p "/usage"` (limits per model group) from a throw-away directory, without a shell. */
export class CliAntigravityQuotaReader implements EngineQuotaReader {
  readonly engine = 'antigravity' as const;

  constructor(private readonly dataDirectory: string) {}

  async readEngineQuota(signal?: AbortSignal): Promise<EngineQuotaReading> {
    try {
      const executable = resolveCliExecutable('agy');
      const probeDirectory = await prepareQuotaProbeDirectory(this.dataDirectory);
      await clearEngineManagedPaths(probeDirectory, null);
      const output = await readQuotaCommandOutput({
        executable,
        args: ['-p', '/usage', '--output-format', 'json'],
        workingDirectory: probeDirectory,
        signal,
      });
      if (output.timedOut) return { state: 'unreadable', buckets: [] };
      const reading = parseAntigravityUsage(output.stdout);
      if (
        reading.state !== 'ok' &&
        SIGNED_OUT_PATTERN.test(`${output.stdout}
${output.stderrTail}`)
      ) {
        return { state: 'not_signed_in', buckets: [] };
      }
      return reading;
    } catch (error) {
      return readingFromFailure(error);
    }
  }
}

function readingFromFailure(error: unknown): EngineQuotaReading {
  const notInstalled = error instanceof AppError && error.code === 'ENGINE_NOT_INSTALLED';
  return { state: notInstalled ? 'not_installed' : 'unreadable', buckets: [] };
}

export function parseAntigravityUsage(stdout: string): EngineQuotaReading {
  const parsed = usageOutputSchema.safeParse(readLastJsonObject(stdout));
  if (!parsed.success || parsed.data.status !== 'SUCCESS') {
    return {
      state: SIGNED_OUT_PATTERN.test(stdout) ? 'not_signed_in' : 'unreadable',
      buckets: [],
    };
  }
  const buckets: EngineQuotaBucket[] = [];
  for (const group of parsed.data.command.data.groups) {
    const appliesToModels = readGroupModels(group.description);
    for (const bucket of group.buckets) {
      const candidate = {
        group: truncateQuotaGroup(group.name),
        ...describeWindow(bucket.window),
        remainingPercent: Math.min(100, Math.max(0, Math.round(bucket.remaining_fraction * 100))),
        resetsAt: normaliseResetTime(bucket.reset_time),
        appliesToModels,
      };
      const checked = engineQuotaBucketSchema.safeParse(candidate);
      if (!checked.success) return { state: 'unreadable', buckets: [] };
      buckets.push(checked.data);
    }
  }
  return { state: 'ok', buckets };
}

function readLastJsonObject(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trimStart().startsWith('{'));
  const lastLine = lines.at(-1);
  if (lastLine === undefined) return undefined;
  try {
    return JSON.parse(lastLine);
  } catch {
    // Not JSON after all: the caller reports the output as unreadable.
    return undefined;
  }
}

function describeWindow(cliWindow: string): Pick<EngineQuotaBucket, 'window' | 'windowLabel'> {
  if (cliWindow === '5h') return { window: 'five_hour', windowLabel: '5 giờ' };
  if (cliWindow === 'weekly') return { window: 'weekly', windowLabel: 'tuần' };
  return { window: 'other', windowLabel: truncateQuotaWindowLabel(cliWindow) };
}

function normaliseResetTime(resetTime: string | null | undefined): string | null {
  if (resetTime === null || resetTime === undefined) return null;
  const timestamp = new Date(resetTime);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

/** "Models within this group: Gemini Flash, Gemini Pro" -> ['gemini']; null when not described. */
function readGroupModels(description: string | undefined): string[] | null {
  const prefixIndex = description?.indexOf(MODELS_PREFIX) ?? -1;
  if (description === undefined || prefixIndex < 0) return null;
  const names = new Set<string>();
  for (const entry of description.slice(prefixIndex + MODELS_PREFIX.length).split(',')) {
    const firstWord = entry.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (firstWord !== '') names.add(firstWord);
  }
  for (const name of [...names]) {
    const prefix = name.split('-')[0] ?? '';
    if (prefix !== '' && prefix !== name) names.add(prefix);
  }
  return names.size === 0 ? null : [...names];
}
