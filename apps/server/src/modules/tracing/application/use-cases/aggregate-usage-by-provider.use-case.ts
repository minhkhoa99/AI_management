import { Inject, Injectable } from '@nestjs/common';
import { AGENT_PROVIDERS, type ProviderUsage } from '@aiteam/contracts';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../../../orchestration/application/ports/task-execution.ports';
import { startOfLocalDay } from '../../domain/local-days';
import { CLOCK, type Clock } from '../ports/clock.port';
import { OVERVIEW_QUERY, type OverviewQuery } from '../ports/overview.query';

/** "Token theo bộ não": today, per engine; money only for Custom API. */
@Injectable()
export class AggregateUsageByProviderUseCase {
  constructor(
    @Inject(OVERVIEW_QUERY) private readonly overviewQuery: OverviewQuery,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  aggregateUsageByProvider(): ProviderUsage {
    this.eventLog.flushPendingEvents();
    const usage = this.overviewQuery.readUsageByProvider(startOfLocalDay(this.clock.currentTime()));
    return AGENT_PROVIDERS.map((provider) => {
      const row = usage.find((candidate) => candidate.provider === provider);
      return {
        provider,
        tokens: row?.tokens ?? 0,
        turns: row?.turns ?? 0,
        costUsd: provider === 'custom_api' ? (row?.costUsd ?? 0) : null,
      };
    });
  }
}
