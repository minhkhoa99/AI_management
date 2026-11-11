import { Inject, Injectable } from '@nestjs/common';
import {
  findQuotaExhaustion,
  localEngineSchema,
  selectApplicableQuotaBuckets,
  type AgentProvider,
  type LocalEngine,
} from '@aiteam/contracts';
import { ENGINE_QUOTA_GATEWAY, type EngineQuotaGateway } from '../ports/engine-quota.port';

/** Extra wait after the engine's reset time, so the turn does not start a moment too early. */
export const QUOTA_RESUME_MARGIN_MS = 60_000;

export interface QuotaWait {
  runAfter: string;
  engineLabel: string;
  windowLabel: string;
}

const ENGINE_LABELS: Record<LocalEngine, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

/**
 * Decides, after a rate-limited turn, whether the engine's plan quota is really used up for the
 * agent's model and when it comes back. No answer means the old retry back-off applies.
 */
@Injectable()
export class QuotaWaitPlanner {
  constructor(@Inject(ENGINE_QUOTA_GATEWAY) private readonly quotaGateway: EngineQuotaGateway) {}

  async planQuotaWait(snapshot: {
    provider: AgentProvider;
    model: string | null;
  }): Promise<QuotaWait | null> {
    const engine = localEngineSchema.safeParse(snapshot.provider);
    if (!engine.success) return null;
    const report = await this.quotaGateway.readFreshEngineQuota(engine.data);
    if (report.state !== 'ok') return null;
    const exhaustion = findQuotaExhaustion(selectApplicableQuotaBuckets(report, snapshot.model));
    if (exhaustion === null) return null;
    return {
      runAfter: new Date(Date.parse(exhaustion.resetsAt) + QUOTA_RESUME_MARGIN_MS).toISOString(),
      engineLabel: ENGINE_LABELS[engine.data],
      windowLabel: exhaustion.bucket.windowLabel,
    };
  }
}
