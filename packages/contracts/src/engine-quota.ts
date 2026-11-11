import { z } from 'zod';
import { engineQuotaStateSchema, quotaWindowSchema } from './enumerations';
import { localEngineSchema } from './providers';

// Plan usage limits of the local engines (Claude Code, Codex, Antigravity).

export const QUOTA_WARNING_PERCENT = 20;
export const QUOTA_CRITICAL_PERCENT = 10;

export const engineQuotaBucketSchema = z.object({
  /** Group shown by the engine (a model family); null when the limit is not grouped. */
  group: z.string().max(80).nullable(),
  window: quotaWindowSchema,
  windowLabel: z.string().max(40),
  remainingPercent: z.number().int().min(0).max(100),
  /** ISO timestamp of the next reset; null when unknown. */
  resetsAt: z.string().nullable(),
  /** Lowercase model names/prefixes this bucket covers; null = every model. */
  appliesToModels: z.array(z.string()).nullable(),
});
export type EngineQuotaBucket = z.infer<typeof engineQuotaBucketSchema>;

export const engineQuotaReportSchema = z.object({
  engine: localEngineSchema,
  state: engineQuotaStateSchema,
  buckets: z.array(engineQuotaBucketSchema),
  checkedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
});
export type EngineQuotaReport = z.infer<typeof engineQuotaReportSchema>;

export const engineQuotaReportListSchema = z.array(engineQuotaReportSchema);

export type QuotaLevel = 'normal' | 'warning' | 'critical';

/** The buckets that limit a run with `model`: shared ones plus model-specific ones that match. */
export function selectApplicableQuotaBuckets(
  report: EngineQuotaReport,
  model: string | null,
): EngineQuotaBucket[] {
  const lowerModel = model === null ? null : model.toLowerCase();
  const sharedBuckets = report.buckets.filter((bucket) => bucket.appliesToModels === null);
  const matchingBuckets = report.buckets.filter(
    (bucket) =>
      bucket.appliesToModels !== null &&
      lowerModel !== null &&
      bucket.appliesToModels.some((name) => lowerModel.includes(name)),
  );
  const hasModelSpecificBuckets = sharedBuckets.length < report.buckets.length;
  if (hasModelSpecificBuckets && sharedBuckets.length === 0 && matchingBuckets.length === 0) {
    return [...report.buckets];
  }
  return report.buckets.filter(
    (bucket) => sharedBuckets.includes(bucket) || matchingBuckets.includes(bucket),
  );
}

function resetTimeOrInfinity(bucket: EngineQuotaBucket): number {
  return bucket.resetsAt === null ? Number.POSITIVE_INFINITY : Date.parse(bucket.resetsAt);
}

/** The bucket with the least left; on a tie, the one that resets sooner. */
export function findLowestQuotaBucket(
  buckets: readonly EngineQuotaBucket[],
): EngineQuotaBucket | null {
  let lowest: EngineQuotaBucket | null = null;
  for (const bucket of buckets) {
    if (
      lowest === null ||
      bucket.remainingPercent < lowest.remainingPercent ||
      (bucket.remainingPercent === lowest.remainingPercent &&
        resetTimeOrInfinity(bucket) < resetTimeOrInfinity(lowest))
    ) {
      lowest = bucket;
    }
  }
  return lowest;
}

/** When every exhausted bucket will be back: the latest reset among the empty ones. */
export function findQuotaExhaustion(
  buckets: readonly EngineQuotaBucket[],
): { resetsAt: string; bucket: EngineQuotaBucket } | null {
  let latest: { resetsAt: string; bucket: EngineQuotaBucket } | null = null;
  for (const bucket of buckets) {
    if (bucket.remainingPercent !== 0 || bucket.resetsAt === null) continue;
    if (latest === null || Date.parse(bucket.resetsAt) > Date.parse(latest.resetsAt)) {
      latest = { resetsAt: bucket.resetsAt, bucket };
    }
  }
  return latest;
}

export function classifyQuotaLevel(remainingPercent: number): QuotaLevel {
  if (remainingPercent < QUOTA_CRITICAL_PERCENT) return 'critical';
  if (remainingPercent < QUOTA_WARNING_PERCENT) return 'warning';
  return 'normal';
}
