import { Inject, Injectable } from '@nestjs/common';
import { type ActivityItem } from '@aiteam/contracts';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../../../orchestration/application/ports/task-execution.ports';
import { describeTaskEvent } from '../../domain/describe-task-event';
import { OVERVIEW_QUERY, type OverviewQuery } from '../ports/overview.query';

/** "Hoạt động gần đây": notable steps across all tasks, newest first. */
@Injectable()
export class ListRecentActivityUseCase {
  constructor(
    @Inject(OVERVIEW_QUERY) private readonly overviewQuery: OverviewQuery,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
  ) {}

  listRecentActivity(limit: number): ActivityItem[] {
    this.eventLog.flushPendingEvents();
    return this.overviewQuery.listRecentActivity(limit).map((record) => ({
      id: record.id,
      kind: record.kind,
      agentName: record.agentName,
      task: { id: record.taskId, code: `T-${record.taskSequenceNumber}`, title: record.taskTitle },
      text: describeTaskEvent(record),
      at: record.createdAt,
    }));
  }
}
