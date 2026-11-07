import type { LiveUpdateBatch } from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveUpdateHub, type LiveUpdateInput } from '../../../../shared/events/live-update-hub';
import { STREAM_BATCH_INTERVAL_MS, StreamLiveUpdatesUseCase } from './stream-live-updates.use-case';

function update(overrides: Partial<LiveUpdateInput>): LiveUpdateInput {
  return {
    type: 'task.changed',
    taskId: 't1',
    departmentId: 'dev',
    agentId: null,
    event: null,
    ...overrides,
  };
}

describe('StreamLiveUpdatesUseCase', () => {
  let hub: LiveUpdateHub;
  let useCase: StreamLiveUpdatesUseCase;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new LiveUpdateHub();
    useCase = new StreamLiveUpdatesUseCase(hub);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups updates into one message per 200 ms', () => {
    const batches: LiveUpdateBatch[] = [];
    const subscription = useCase
      .streamLiveUpdates({ kind: 'task', taskId: 't1' }, null)
      .subscribe((batch) => batches.push(batch));

    hub.publishLiveUpdate(update({}));
    hub.publishLiveUpdate(update({ type: 'task.event' }));
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(STREAM_BATCH_INTERVAL_MS);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.items.map((item) => item.sequence)).toEqual([1, 2]);
    subscription.unsubscribe();
    expect(hub.countListeners()).toBe(0);
  });

  it('keeps each scope to its own updates', () => {
    const workspace: LiveUpdateBatch[] = [];
    const department: LiveUpdateBatch[] = [];
    const task: LiveUpdateBatch[] = [];
    useCase
      .streamLiveUpdates({ kind: 'workspace' }, null)
      .subscribe((batch) => workspace.push(batch));
    useCase
      .streamLiveUpdates({ kind: 'department', departmentId: 'dev' }, null)
      .subscribe((batch) => department.push(batch));
    useCase
      .streamLiveUpdates({ kind: 'task', taskId: 't2' }, null)
      .subscribe((batch) => task.push(batch));

    hub.publishLiveUpdate(update({ type: 'task.event' }));
    hub.publishLiveUpdate(update({ taskId: 't2', departmentId: 'ops' }));
    hub.publishLiveUpdate(update({ type: 'approval.changed', taskId: 't1', departmentId: null }));
    vi.advanceTimersByTime(STREAM_BATCH_INTERVAL_MS);

    const types = (batches: LiveUpdateBatch[]) =>
      batches.flatMap((batch) => batch.items.map((item) => `${item.type}:${item.taskId ?? ''}`));
    expect(types(workspace)).toEqual(['task.changed:t2', 'approval.changed:t1']);
    expect(types(department)).toEqual(['task.event:t1', 'approval.changed:t1']);
    expect(types(task)).toEqual(['task.changed:t2']);
  });

  it('replays what a reconnecting client missed (Last-Event-ID)', () => {
    hub.publishLiveUpdate(update({}));
    hub.publishLiveUpdate(update({}));
    hub.publishLiveUpdate(update({}));
    const batches: LiveUpdateBatch[] = [];

    useCase.streamLiveUpdates({ kind: 'workspace' }, 1).subscribe((batch) => batches.push(batch));
    vi.advanceTimersByTime(0);

    expect(batches[0]?.items.map((item) => item.sequence)).toEqual([2, 3]);
  });

  it('drops a listener that throws without affecting the others', () => {
    const received: number[] = [];
    hub.subscribeToLiveUpdates(() => {
      throw new Error('broken stream');
    });
    hub.subscribeToLiveUpdates((item) => received.push(item.sequence));

    hub.publishLiveUpdate(update({}));
    hub.publishLiveUpdate(update({}));

    expect(received).toEqual([1, 2]);
    expect(hub.countListeners()).toBe(1);
  });
});
