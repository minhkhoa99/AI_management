import { Module } from '@nestjs/common';
import { TASK_EVENT_LOG } from '../orchestration/application/ports/task-execution.ports';
import { CLOCK } from './application/ports/clock.port';
import { OVERVIEW_QUERY } from './application/ports/overview.query';
import { AggregateHourlyThroughputUseCase } from './application/use-cases/aggregate-hourly-throughput.use-case';
import { AggregateUsageByProviderUseCase } from './application/use-cases/aggregate-usage-by-provider.use-case';
import { CalculateOverviewMetricsUseCase } from './application/use-cases/calculate-overview-metrics.use-case';
import { ListRecentActivityUseCase } from './application/use-cases/list-recent-activity.use-case';
import { ListTaskEventsUseCase } from './application/use-cases/list-task-events.use-case';
import { StreamLiveUpdatesUseCase } from './application/use-cases/stream-live-updates.use-case';
import { SummarizeUsageTodayUseCase } from './application/use-cases/summarize-usage-today.use-case';
import { BatchedTaskEventLog } from './infrastructure/persistence/batched-task-event-log';
import { SqliteOverviewQuery } from './infrastructure/persistence/sqlite-overview.query';
import { LiveStreamsController } from './presentation/controllers/live-streams.controller';
import { OverviewController } from './presentation/controllers/overview.controller';

/** Task log (batched writes), live update streams (SSE) and the overview figures. */
@Module({
  controllers: [LiveStreamsController, OverviewController],
  providers: [
    BatchedTaskEventLog,
    { provide: TASK_EVENT_LOG, useExisting: BatchedTaskEventLog },
    { provide: OVERVIEW_QUERY, useClass: SqliteOverviewQuery },
    { provide: CLOCK, useValue: { currentTime: () => new Date() } },
    ListTaskEventsUseCase,
    StreamLiveUpdatesUseCase,
    CalculateOverviewMetricsUseCase,
    AggregateHourlyThroughputUseCase,
    AggregateUsageByProviderUseCase,
    SummarizeUsageTodayUseCase,
    ListRecentActivityUseCase,
  ],
  // Orchestration records every agent event through this log.
  exports: [TASK_EVENT_LOG],
})
export class TracingModule {}
