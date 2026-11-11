import { describe, expect, it } from 'vitest';
import { Task } from './task';

function newTask(): Task {
  return Task.createNew({
    id: 'task-1',
    sequenceNumber: 1,
    departmentId: 'dept-1',
    workflowId: null,
    assigneeAgentId: 'agent-1',
    workingDirectory: null,
    title: 'API đăng nhập',
    description: '',
    criteria: '',
    priority: 2,
    testCommand: null,
    previewCommand: null,
  });
}

const WAIT = { runAfter: '2026-11-12T10:01:00.000Z', note: '⏸ Chờ hạn mức' };

describe('Task pending review', () => {
  it('waits in the queue for the reviewer quota and reports the review once', () => {
    const task = newTask();

    task.waitForReviewQuota(WAIT);

    expect(task.toState()).toMatchObject({
      status: 'queued',
      runAfter: WAIT.runAfter,
      statusNote: WAIT.note,
      reviewPending: true,
    });
    expect(task.takePendingReview()).toBe(true);
    expect(task.takePendingReview()).toBe(false);
  });

  it('keeps the pending review across pause and resume', () => {
    const task = newTask();
    task.waitForReviewQuota(WAIT);

    task.pause();
    task.resume();

    expect(task.toState().reviewPending).toBe(true);
  });

  it('drops the pending review when the task is requeued, fails or is cancelled', () => {
    for (const leaveQueue of [
      (task: Task) => task.requeue({ stepId: null, retriesUsed: 0 }),
      (task: Task) => task.fail('lỗi'),
      (task: Task) => task.beginCancelling(),
    ]) {
      const task = newTask();
      task.waitForReviewQuota(WAIT);

      leaveQueue(task);

      expect(task.toState().reviewPending).toBe(false);
    }
  });
});
