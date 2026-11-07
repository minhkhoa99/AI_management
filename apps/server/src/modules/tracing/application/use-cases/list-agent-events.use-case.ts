import { Injectable } from '@nestjs/common';
import type { TaskEvent } from '@aiteam/contracts';
import { describeTaskEvent, describeTaskEventDetail } from '../../domain/describe-task-event';
import { BatchedTaskEventLog } from '../../infrastructure/persistence/batched-task-event-log';

/** Monitor "Hoạt động" tab: what an agent did across its tasks (the text starts with the task). */
@Injectable()
export class ListAgentEventsUseCase {
  constructor(private readonly eventLog: BatchedTaskEventLog) {}

  listAgentEvents(agentId: string, limit: number): TaskEvent[] {
    return this.eventLog.listAgentEvents(agentId, limit).map((event) => ({
      id: event.id,
      kind: event.kind,
      agentName: event.agentName,
      text: `T-${event.taskSequenceNumber} · ${describeTaskEvent(event)}`,
      ...describeTaskEventDetail(event),
      createdAt: event.createdAt,
    }));
  }
}
