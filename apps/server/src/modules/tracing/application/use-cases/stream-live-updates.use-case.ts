import { Injectable } from '@nestjs/common';
import type { LiveUpdate, LiveUpdateBatch } from '@aiteam/contracts';
import { Observable } from 'rxjs';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';

/** Plan §5.10: updates are grouped before being pushed, one SSE message per 200 ms at most. */
export const STREAM_BATCH_INTERVAL_MS = 200;

export type LiveUpdateScope =
  /** Board, bell, overview: every task and approval change, no log lines. */
  | { kind: 'workspace' }
  /** Monitor grid and org chart: changes and log lines of the department's tasks. */
  | { kind: 'department'; departmentId: string }
  /** Task detail and agent workspace: everything about one task. */
  | { kind: 'task'; taskId: string };

function isInScope(update: LiveUpdate, scope: LiveUpdateScope): boolean {
  switch (scope.kind) {
    case 'workspace':
      return update.type !== 'task.event';
    case 'department':
      return update.departmentId === scope.departmentId || update.type === 'approval.changed';
    case 'task':
      return update.taskId === scope.taskId;
  }
}

/**
 * A screen's live stream: what it missed since `lastSequence` (when the server still has it),
 * then new updates in 200 ms batches. Completing the observable (client gone) unsubscribes.
 */
@Injectable()
export class StreamLiveUpdatesUseCase {
  constructor(private readonly liveUpdateHub: LiveUpdateHub) {}

  streamLiveUpdates(
    scope: LiveUpdateScope,
    lastSequence: number | null,
  ): Observable<LiveUpdateBatch> {
    return new Observable<LiveUpdateBatch>((subscriber) => {
      let buffered: LiveUpdate[] =
        lastSequence === null
          ? []
          : this.liveUpdateHub
              .listUpdatesSince(lastSequence)
              .filter((update) => isInScope(update, scope));
      let timer: NodeJS.Timeout | undefined;
      const flush = () => {
        timer = undefined;
        if (buffered.length === 0) return;
        const items = buffered;
        buffered = [];
        subscriber.next({ items });
      };
      const unsubscribe = this.liveUpdateHub.subscribeToLiveUpdates((update) => {
        if (!isInScope(update, scope)) return;
        buffered.push(update);
        timer ??= setTimeout(flush, STREAM_BATCH_INTERVAL_MS);
      });
      if (buffered.length > 0) timer = setTimeout(flush, 0);
      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    });
  }
}
