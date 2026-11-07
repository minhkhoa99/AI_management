import { Inject, Injectable } from '@nestjs/common';
import type { TaskEvent } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
} from '../../../orchestration/application/ports/task-execution.ports';
import { describeTaskEvent, describeTaskEventDetail } from '../../domain/describe-task-event';

/** "Nhật ký task": the latest events of a task, one readable line each. */
@Injectable()
export class ListTaskEventsUseCase {
  constructor(@Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog) {}

  listTaskEvents(taskId: string, limit: number): TaskEvent[] {
    if (!this.eventLog.hasTask(taskId)) {
      throw new NotFoundError('Không tìm thấy task.', { code: 'TASK_NOT_FOUND' });
    }
    return this.eventLog.listTaskEvents(taskId, limit).map((event) => ({
      id: event.id,
      kind: event.kind,
      agentName: event.agentName,
      text: describeTaskEvent(event),
      ...describeTaskEventDetail(event),
      createdAt: event.createdAt,
    }));
  }
}
