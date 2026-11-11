import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../domain/entities/task';
import { TaskCheckpoints } from './task-checkpoints';

const SAVED_CHECKPOINT = { sha: 'abc123', files: ['a.ts', 'b.ts'] };

function buildCheckpoints(workspace: {
  saveCheckpoint: () => Promise<unknown>;
  listUncommittedEngineManagedPaths: () => Promise<unknown>;
}) {
  const checkpointRepository = { insertCheckpoint: vi.fn() };
  const eventLog = { recordTaskEvent: vi.fn() };
  const logger = { warn: vi.fn() };
  const checkpoints = new TaskCheckpoints(
    workspace as never,
    checkpointRepository as never,
    eventLog as never,
    { generateId: () => 'checkpoint-1' },
    logger as never,
  );
  const task = {
    id: 'task-1',
    currentStepId: 'step-1',
    assigneeAgentId: 'agent-1',
    toState: () => ({ worktreePath: '/work' }),
  } as unknown as Task;
  return { checkpoints, checkpointRepository, eventLog, logger, task };
}

describe('TaskCheckpoints.saveTaskCheckpoint', () => {
  it('still records the checkpoint when listing the left-out paths throws', async () => {
    const failure = new Error('git ls-files failed');
    const { checkpoints, checkpointRepository, eventLog, logger, task } = buildCheckpoints({
      saveCheckpoint: () => Promise.resolve(SAVED_CHECKPOINT),
      listUncommittedEngineManagedPaths: () => Promise.reject(failure),
    });

    await expect(checkpoints.saveTaskCheckpoint(task, 'turn 1')).resolves.toBeUndefined();

    expect(checkpointRepository.insertCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', sha: 'abc123', files: ['a.ts', 'b.ts'] }),
    );
    expect(eventLog.recordTaskEvent).toHaveBeenCalledTimes(1);
    expect(eventLog.recordTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'checkpoint' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, taskId: 'task-1' }),
      expect.any(String),
    );
  });

  it('records the left-out note after the checkpoint, and also when nothing changed', async () => {
    const { checkpoints, checkpointRepository, eventLog, task } = buildCheckpoints({
      saveCheckpoint: () => Promise.resolve(null),
      listUncommittedEngineManagedPaths: () =>
        Promise.resolve({ paths: ['.agents/a.md', '.gemini'], total: 2 }),
    });

    await checkpoints.saveTaskCheckpoint(task, 'turn 1');

    expect(checkpointRepository.insertCheckpoint).not.toHaveBeenCalled();
    expect(eventLog.recordTaskEvent).toHaveBeenCalledTimes(1);
    expect(eventLog.recordTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'message',
        payload: expect.objectContaining({
          platformNote: true,
          text: expect.stringContaining('2 file'),
        }),
      }),
    );
  });

  it('puts the note after the checkpoint event on the timeline', async () => {
    const { checkpoints, eventLog, task } = buildCheckpoints({
      saveCheckpoint: () => Promise.resolve(SAVED_CHECKPOINT),
      listUncommittedEngineManagedPaths: () => Promise.resolve({ paths: ['.gemini'], total: 1 }),
    });

    await checkpoints.saveTaskCheckpoint(task, 'turn 1');

    expect(
      eventLog.recordTaskEvent.mock.calls.map(([event]) => (event as { kind: string }).kind),
    ).toEqual(['checkpoint', 'message']);
  });

  it('reports the total count, not the capped list length, in the note', async () => {
    const paths = Array.from({ length: 20 }, (_, index) => `_agents/f${index}.md`);
    const { checkpoints, eventLog, task } = buildCheckpoints({
      saveCheckpoint: () => Promise.resolve(null),
      listUncommittedEngineManagedPaths: () => Promise.resolve({ paths, total: 30 }),
    });

    await checkpoints.saveTaskCheckpoint(task, 'turn 1');

    const note = eventLog.recordTaskEvent.mock.calls[0]?.[0] as { payload: { text: string } };
    expect(note.payload.text).toContain('30 file');
    expect(note.payload.text).not.toContain('20 file');
  });
});
