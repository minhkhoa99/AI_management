import type { EngineQuotaBucket, EngineQuotaState, LocalEngine } from '@aiteam/contracts';

export const ENGINE_QUOTA_READERS = Symbol('ENGINE_QUOTA_READERS');

/** What one engine's quota query found; the service adds the timestamps. */
export type EngineQuotaReading = { state: EngineQuotaState; buckets: EngineQuotaBucket[] };

export interface EngineQuotaReader {
  readonly engine: LocalEngine;
  /** Never throws: every failure is reported through `state`. */
  readEngineQuota(): Promise<EngineQuotaReading>;
}
