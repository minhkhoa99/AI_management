import { z } from 'zod';
import { type EngineQuotaBucket, engineQuotaBucketSchema } from '@aiteam/contracts';
import { AppError } from '../../../../../shared/errors/app-error';
import type {
  EngineQuotaReader,
  EngineQuotaReading,
} from '../../../application/ports/engine-quota-reader.port';
import { resolveCliExecutable, streamCliOutput } from '../engines/cli-process';
import { prepareQuotaProbeDirectory } from './quota-probe-directory';

const QUOTA_TIMEOUT_MS = 20_000;
const RATE_LIMITS_REQUEST_ID = 2;
const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 10_080;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const SIGNED_OUT_PATTERN = /401|unauthori[sz]ed|sign in|refresh token|log ?in/i;

export const CODEX_QUOTA_REQUEST_LINES: readonly string[] = [
  JSON.stringify({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'aiteam', version: '1' } },
  }),
  JSON.stringify({ method: 'initialized' }),
  JSON.stringify({ id: RATE_LIMITS_REQUEST_ID, method: 'account/rateLimits/read' }),
];

const windowSchema = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number(),
  resetsAt: z.number().nullish(),
});
const snapshotSchema = z.object({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
  rateLimitReachedType: z.string().nullish(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const rateLimitsLineSchema = z.object({
  id: z.literal(RATE_LIMITS_REQUEST_ID),
  error: z.object({ message: z.string().optional() }).optional(),
  result: z
    .object({
      rateLimits: snapshotSchema.nullish(),
      rateLimitsByLimitId: z.record(z.string(), snapshotSchema).nullish(),
    })
    .optional(),
});

/** Asks `codex app-server` (JSON-RPC over stdio) for the account rate limits, without a shell. */
export class CliCodexQuotaReader implements EngineQuotaReader {
  readonly engine = 'codex' as const;

  constructor(
    private readonly dataDirectory: string,
    private readonly timeoutMilliseconds: number = QUOTA_TIMEOUT_MS,
  ) {}

  async readEngineQuota(signal?: AbortSignal): Promise<EngineQuotaReading> {
    try {
      const executable = resolveCliExecutable('codex');
      const probeDirectory = await prepareQuotaProbeDirectory(this.dataDirectory);
      const timeoutSignal = AbortSignal.timeout(this.timeoutMilliseconds);
      const output = streamCliOutput(
        {
          executable,
          args: ['app-server'],
          workingDirectory: probeDirectory,
          stdinText: `${CODEX_QUOTA_REQUEST_LINES.join('\n')}\n`,
          keepStdinOpen: true,
        },
        signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]),
      );
      for await (const item of output) {
        if (item.kind !== 'line') break;
        const reading = parseCodexRateLimitLine(item.text);
        if (reading !== null) return reading;
      }
      return { state: 'unreadable', buckets: [] };
    } catch (error) {
      const notInstalled = error instanceof AppError && error.code === 'ENGINE_NOT_INSTALLED';
      return { state: notInstalled ? 'not_installed' : 'unreadable', buckets: [] };
    }
  }
}

/** Parses the answer to request id 2; null when the line is anything else. */
export function parseCodexRateLimitLine(line: string): EngineQuotaReading | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    // Not JSON: not the line being waited for.
    return null;
  }
  if (typeof json !== 'object' || json === null || (json as { id?: unknown }).id !== 2) return null;
  const parsed = rateLimitsLineSchema.safeParse(json);
  if (!parsed.success) return { state: 'unreadable', buckets: [] };
  if (parsed.data.error !== undefined) {
    const signedOut = SIGNED_OUT_PATTERN.test(parsed.data.error.message ?? '');
    return { state: signedOut ? 'not_signed_in' : 'unreadable', buckets: [] };
  }
  const result = parsed.data.result;
  if (result === undefined) return { state: 'unreadable', buckets: [] };
  const snapshots: Snapshot[] =
    result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length > 0
      ? Object.values(result.rateLimitsByLimitId)
      : result.rateLimits
        ? [result.rateLimits]
        : [];
  const buckets: EngineQuotaBucket[] = [];
  for (const snapshot of snapshots) {
    const windows = [snapshot.primary, snapshot.secondary].filter((window): window is CodexWindow =>
      Boolean(window),
    );
    const reachedWindow = snapshot.rateLimitReachedType ? findReachedWindow(windows) : null;
    for (const window of windows) {
      const checked = engineQuotaBucketSchema.safeParse({
        group: snapshot.limitName ?? snapshot.limitId ?? null,
        ...describeWindow(window.windowDurationMins),
        remainingPercent: window === reachedWindow ? 0 : remainingPercentOf(window),
        resetsAt: epochSecondsToIso(window.resetsAt),
        appliesToModels: null,
      });
      if (!checked.success) return { state: 'unreadable', buckets: [] };
      buckets.push(checked.data);
    }
  }
  return { state: buckets.length === 0 ? 'not_applicable' : 'ok', buckets };
}

type CodexWindow = z.infer<typeof windowSchema>;

function remainingPercentOf(window: CodexWindow): number {
  return Math.min(100, Math.max(0, Math.round(100 - window.usedPercent)));
}

/**
 * Codex says the limit is reached but not which window: when no window already shows 0% left, the
 * fullest one (on a tie, the one that resets first) is the one that ran out. The others keep
 * their real numbers, so the wait is for that window's reset and nothing is made up.
 */
function findReachedWindow(windows: readonly CodexWindow[]): CodexWindow | null {
  if (windows.some((window) => remainingPercentOf(window) === 0)) return null;
  let fullest: CodexWindow | null = null;
  for (const window of windows) {
    if (
      fullest === null ||
      window.usedPercent > fullest.usedPercent ||
      (window.usedPercent === fullest.usedPercent &&
        resetOrInfinity(window) < resetOrInfinity(fullest))
    ) {
      fullest = window;
    }
  }
  return fullest;
}

function resetOrInfinity(window: CodexWindow): number {
  return window.resetsAt ?? Number.POSITIVE_INFINITY;
}

function describeWindow(minutes: number): Pick<EngineQuotaBucket, 'window' | 'windowLabel'> {
  if (minutes === FIVE_HOUR_MINUTES) return { window: 'five_hour', windowLabel: '5 giờ' };
  if (minutes === WEEK_MINUTES) return { window: 'weekly', windowLabel: 'tuần' };
  if (minutes % MINUTES_PER_HOUR === 0 && minutes < MINUTES_PER_DAY) {
    return { window: 'other', windowLabel: `${minutes / MINUTES_PER_HOUR} giờ` };
  }
  return { window: 'other', windowLabel: `${Math.round(minutes / MINUTES_PER_DAY)} ngày` };
}

function epochSecondsToIso(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  const timestamp = new Date(epochSeconds * 1000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
