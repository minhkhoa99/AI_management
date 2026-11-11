import { Inject, Injectable } from '@nestjs/common';
import {
  findQuotaExhaustion,
  formatQuotaResumeTime,
  localEngineSchema,
  QUOTA_RESET_HORIZON_MS,
  selectApplicableQuotaBuckets,
  type AgentProvider,
  type LocalEngine,
} from '@aiteam/contracts';
import { QUOTA_WAIT_NOTE_PREFIX } from '../../domain/entities/task';
import { ENGINE_QUOTA_GATEWAY, type EngineQuotaGateway } from '../ports/engine-quota.port';

/** Extra wait after the engine's reset time, so the turn does not start a moment too early. */
export const QUOTA_RESUME_MARGIN_MS = 60_000;

export interface QuotaWait {
  runAfter: string;
  engineLabel: string;
  windowLabel: string;
}

/** The task's status note while it waits (worker turn or superior's review alike). */
export function buildQuotaWaitNote(wait: QuotaWait): string {
  return `${QUOTA_WAIT_NOTE_PREFIX} ${wait.windowLabel} của ${wait.engineLabel} · tự chạy tiếp lúc ${formatQuotaResumeTime(wait.runAfter)}`;
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

  async planQuotaWait(
    snapshot: { provider: AgentProvider; model: string | null },
    nowEpochMs: number = Date.now(),
  ): Promise<QuotaWait | null> {
    const engine = localEngineSchema.safeParse(snapshot.provider);
    if (!engine.success) return null;
    const report = await this.quotaGateway.readFreshEngineQuota(engine.data);
    if (report.state !== 'ok') return null;
    const exhaustion = findQuotaExhaustion(selectApplicableQuotaBuckets(report, snapshot.model));
    if (exhaustion === null) return null;
    const runAfterEpochMs = Date.parse(exhaustion.resetsAt) + QUOTA_RESUME_MARGIN_MS;
    // A reset that already passed is stale data: waiting would loop with no failure cap. One
    // further away than the longest plan window is misread: never park a task that long.
    if (
      Number.isNaN(runAfterEpochMs) ||
      runAfterEpochMs <= nowEpochMs ||
      runAfterEpochMs > nowEpochMs + QUOTA_RESET_HORIZON_MS
    ) {
      return null;
    }
    return {
      runAfter: new Date(runAfterEpochMs).toISOString(),
      engineLabel: ENGINE_LABELS[engine.data],
      windowLabel: exhaustion.bucket.windowLabel,
    };
  }
}
