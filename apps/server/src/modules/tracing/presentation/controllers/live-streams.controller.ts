import { Controller, Get, Headers, Param, Query, Sse } from '@nestjs/common';
import { entityIdSchema, TASK_EVENT_LIST_MAX, type TaskEvent } from '@aiteam/contracts';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { ListTaskEventsUseCase } from '../../application/use-cases/list-task-events.use-case';
import {
  type LiveUpdateScope,
  StreamLiveUpdatesUseCase,
} from '../../application/use-cases/stream-live-updates.use-case';

const departmentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã phòng ban');
const taskIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã task');

/** Last-Event-ID sent by a reconnecting EventSource; anything unexpected means "from now". */
function parseLastEventId(header: string | undefined): number | null {
  const parsed = Number(header);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

interface SseMessage {
  id: string;
  // `data` is the field name Nest's SSE MessageEvent requires.
  // eslint-disable-next-line id-denylist
  data: object;
}

@Controller('api')
export class LiveStreamsController {
  constructor(
    private readonly streamLiveUpdatesUseCase: StreamLiveUpdatesUseCase,
    private readonly listTaskEventsUseCase: ListTaskEventsUseCase,
  ) {}

  @Sse('stream/workspace')
  streamWorkspace(@Headers('last-event-id') lastEventId?: string): Observable<SseMessage> {
    return this.toSseMessages({ kind: 'workspace' }, lastEventId);
  }

  @Sse('stream/departments/:departmentId')
  streamDepartment(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<SseMessage> {
    return this.toSseMessages({ kind: 'department', departmentId }, lastEventId);
  }

  @Sse('stream/tasks/:taskId')
  streamTask(
    @Param('taskId', taskIdPipe) taskId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<SseMessage> {
    return this.toSseMessages({ kind: 'task', taskId }, lastEventId);
  }

  @Get('tasks/:taskId/events')
  listTaskEvents(
    @Param('taskId', taskIdPipe) taskId: string,
    @Query(
      'limit',
      new ZodRequestPipe(
        z.coerce.number().int().min(1).max(TASK_EVENT_LIST_MAX).default(50),
        'Số dòng',
      ),
    )
    limit: number,
  ): TaskEvent[] {
    return this.listTaskEventsUseCase.listTaskEvents(taskId, limit);
  }

  private toSseMessages(scope: LiveUpdateScope, lastEventId: string | undefined) {
    return this.streamLiveUpdatesUseCase
      .streamLiveUpdates(scope, parseLastEventId(lastEventId))
      .pipe(
        // eslint-disable-next-line id-denylist -- Nest SSE MessageEvent field
        map((batch) => ({ id: String(batch.items.at(-1)?.sequence ?? 0), data: batch })),
      );
  }
}
