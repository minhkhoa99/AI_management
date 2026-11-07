import { Inject, Injectable } from '@nestjs/common';
import { OVERVIEW_DAY_COUNT, type OverviewMetrics } from '@aiteam/contracts';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../../../orchestration/application/ports/task-execution.ports';
import { listRecentLocalDays, startOfLocalDay } from '../../domain/local-days';
import { CLOCK, type Clock } from '../ports/clock.port';
import { OVERVIEW_QUERY, type OverviewQuery } from '../ports/overview.query';

/** The 4 KPI cards: tasks done, agents at work, QC pass rate, tokens (and Custom API cost). */
@Injectable()
export class CalculateOverviewMetricsUseCase {
  constructor(
    @Inject(OVERVIEW_QUERY) private readonly overviewQuery: OverviewQuery,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  calculateOverviewMetrics(): OverviewMetrics {
    this.eventLog.flushPendingEvents();
    const now = this.clock.currentTime();
    const days = listRecentLocalDays(now, OVERVIEW_DAY_COUNT);
    const figures = this.overviewQuery.readDailyFigures(
      startOfLocalDay(now, OVERVIEW_DAY_COUNT - 1),
    );
    const tasksDoneByDay = days.map((day) => figures.tasksDone.get(day) ?? 0);
    const tokensByDay = days.map((day) => figures.tokens.get(day) ?? 0);
    const qcPassRateByDay = days.map((day) => {
      const gates = figures.qcGates.get(day);
      return gates === undefined || gates.total === 0
        ? null
        : Math.round((gates.passed / gates.total) * 100);
    });
    const agents = this.overviewQuery.countAgents();
    return {
      tasksDoneToday: tasksDoneByDay.at(-1) ?? 0,
      tasksDoneYesterday: tasksDoneByDay.at(-2) ?? 0,
      tasksDoneByDay,
      agentsWorking: agents.working,
      agentsEnabled: agents.enabled,
      agentsTotal: agents.total,
      qcPassRateToday: qcPassRateByDay.at(-1) ?? null,
      qcPassRateByDay,
      tokensToday: tokensByDay.at(-1) ?? 0,
      tokensYesterday: tokensByDay.at(-2) ?? 0,
      tokensByDay,
      apiCostTodayUsd: this.overviewQuery.sumApiCostUsd(startOfLocalDay(now)),
    };
  }
}
