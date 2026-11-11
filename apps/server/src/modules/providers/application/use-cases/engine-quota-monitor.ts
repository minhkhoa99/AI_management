import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LOCAL_ENGINES, type EngineQuotaReport, type LocalEngine } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  LOCAL_ENGINE_ADAPTERS_OVERRIDE,
  type LocalEngineAdaptersOverride,
} from '../../../../shared/runtime/local-engine-adapters-override';
import type { EngineQuotaGateway } from '../../../orchestration/application/ports/engine-quota.port';
import {
  ENGINE_QUOTA_READERS,
  type EngineQuotaReader,
  type EngineQuotaReading,
} from '../ports/engine-quota-reader.port';

export const ENGINE_QUOTA_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const ENGINE_QUOTA_MIN_SPACING_MS = 30 * 1000;

/**
 * Keeps the latest plan-quota report of each local engine: one read in flight per engine,
 * polled every 5 minutes, re-read on request (spaced 30 s) and announced to the UI.
 */
@Injectable()
export class EngineQuotaMonitor implements EngineQuotaGateway, OnModuleInit, OnModuleDestroy {
  private readonly readersByEngine = new Map<LocalEngine, EngineQuotaReader>();
  private readonly reports = new Map<LocalEngine, EngineQuotaReport>();
  private readonly readsInFlight = new Map<LocalEngine, Promise<EngineQuotaReport>>();
  private readonly lastReadStartedAt = new Map<LocalEngine, number>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENGINE_QUOTA_READERS) readers: EngineQuotaReader[],
    private readonly liveUpdateHub: LiveUpdateHub,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    @Inject(LOCAL_ENGINE_ADAPTERS_OVERRIDE)
    private readonly adaptersOverride: LocalEngineAdaptersOverride,
  ) {
    for (const reader of readers) this.readersByEngine.set(reader.engine, reader);
  }

  onModuleInit(): void {
    // Tests (an override is present) never poll and never spawn CLIs at boot.
    if (this.adaptersOverride !== null) return;
    void this.refreshAllEngineQuotas();
    this.pollTimer = setInterval(() => {
      void this.refreshAllEngineQuotas();
    }, ENGINE_QUOTA_POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  listEngineQuotas(): EngineQuotaReport[] {
    return LOCAL_ENGINES.map((engine) => this.reports.get(engine) ?? neverReadReport(engine));
  }

  refreshAllEngineQuotas(): Promise<EngineQuotaReport[]> {
    return Promise.all(LOCAL_ENGINES.map((engine) => this.readFreshEngineQuota(engine)));
  }

  readFreshEngineQuota(engine: LocalEngine): Promise<EngineQuotaReport> {
    const running = this.readsInFlight.get(engine);
    if (running !== undefined) return running;
    const started = this.readAndStoreEngineQuota(engine).finally(() => {
      this.readsInFlight.delete(engine);
    });
    this.readsInFlight.set(engine, started);
    return started;
  }

  requestEngineQuotaRefresh(engine: LocalEngine): void {
    if (this.readsInFlight.has(engine)) return;
    const lastStartedAt = this.lastReadStartedAt.get(engine);
    if (lastStartedAt !== undefined && Date.now() - lastStartedAt < ENGINE_QUOTA_MIN_SPACING_MS) {
      return;
    }
    // readFreshEngineQuota never rejects.
    void this.readFreshEngineQuota(engine);
  }

  private async readAndStoreEngineQuota(engine: LocalEngine): Promise<EngineQuotaReport> {
    const startedAt = Date.now();
    this.lastReadStartedAt.set(engine, startedAt);
    const reading = await this.readOrUnreadable(engine);
    const report = mergeReading(this.reports.get(engine) ?? neverReadReport(engine), reading);
    this.reports.set(engine, report);
    this.logger.debug(
      { engine, state: report.state, durationMs: Date.now() - startedAt },
      'engine quota read',
    );
    this.liveUpdateHub.publishLiveUpdate({
      type: 'engine_quota.changed',
      taskId: null,
      departmentId: null,
      agentId: null,
      event: null,
    });
    return report;
  }

  private async readOrUnreadable(engine: LocalEngine): Promise<EngineQuotaReading> {
    const reader = this.readersByEngine.get(engine);
    if (reader === undefined) return { state: 'unreadable', buckets: [] };
    try {
      return await reader.readEngineQuota();
    } catch (error) {
      // Readers never throw by contract; an unexpected failure must not escape the monitor.
      this.logger.warn(
        { engine, code: error instanceof AppError ? error.code : 'UNEXPECTED_QUOTA_READ_FAILURE' },
        'engine quota reader failed',
      );
      return { state: 'unreadable', buckets: [] };
    }
  }
}

function neverReadReport(engine: LocalEngine): EngineQuotaReport {
  return { engine, state: 'unreadable', buckets: [], checkedAt: null, lastSuccessAt: null };
}

function mergeReading(previous: EngineQuotaReport, reading: EngineQuotaReading): EngineQuotaReport {
  const checkedAt = new Date().toISOString();
  switch (reading.state) {
    case 'ok':
    case 'not_applicable':
      return {
        engine: previous.engine,
        state: reading.state,
        buckets: reading.buckets,
        checkedAt,
        lastSuccessAt: checkedAt,
      };
    case 'unreadable':
      return { ...previous, state: 'unreadable', checkedAt };
    default:
      return { ...previous, state: reading.state, buckets: [], checkedAt };
  }
}
