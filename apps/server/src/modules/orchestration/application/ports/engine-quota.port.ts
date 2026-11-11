import type { EngineQuotaReport, LocalEngine } from '@aiteam/contracts';

export const ENGINE_QUOTA_GATEWAY = Symbol('ENGINE_QUOTA_GATEWAY');

export interface EngineQuotaGateway {
  /** Reads the engine's quota now (skips the 30 s spacing); never rejects. */
  readFreshEngineQuota(engine: LocalEngine): Promise<EngineQuotaReport>;
  /** Asks for a re-read soon (spaced ≥ 30 s per engine); returns at once. */
  requestEngineQuotaRefresh(engine: LocalEngine): void;
}
