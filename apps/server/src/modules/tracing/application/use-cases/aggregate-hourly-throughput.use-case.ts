import { Inject, Injectable } from '@nestjs/common';
import { type HourlyThroughput } from '@aiteam/contracts';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../../../orchestration/application/ports/task-execution.ports';
import { startOfLocalDay } from '../../domain/local-days';
import { CLOCK, type Clock } from '../ports/clock.port';
import { OVERVIEW_QUERY, type OverviewQuery } from '../ports/overview.query';

/** "Task xử lý theo giờ": today, every hour from midnight to now. */
@Injectable()
export class AggregateHourlyThroughputUseCase {
  constructor(
    @Inject(OVERVIEW_QUERY) private readonly overviewQuery: OverviewQuery,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  aggregateHourlyThroughput(): HourlyThroughput {
    this.eventLog.flushPendingEvents();
    const now = this.clock.currentTime();
    const byHour = this.overviewQuery.readHourlyThroughput(startOfLocalDay(now));
    return Array.from({ length: now.getHours() + 1 }, (_unused, hour) => ({
      hour,
      done: byHour.get(hour)?.done ?? 0,
      reworked: byHour.get(hour)?.reworked ?? 0,
    }));
  }
}
