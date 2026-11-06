import type { AgentEngineEvent } from '@aiteam/contracts';
import { describe, expect, it, vi } from 'vitest';
import { EngineUnavailableError } from '../errors/app-error';
import type { AppLogger } from '../logging/app-logger';
import {
  AgentSessionSupervisor,
  type SupervisedSession,
  type TerminalEngineEvent,
} from './agent-session-supervisor';

function createSupervisor() {
  let nextId = 0;
  const logger = { ['info']: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  return {
    supervisor: new AgentSessionSupervisor(
      { generateId: () => `session-${(nextId += 1)}` },
      logger,
    ),
    logger,
  };
}

/** A fake task: records what the supervisor reports and resolves when the session finished. */
function createFakeTask(
  ownerLabel: string,
  openSession: (signal: AbortSignal) => AsyncIterable<AgentEngineEvent>,
) {
  const received: AgentEngineEvent[] = [];
  let resolveFinished: (event: TerminalEngineEvent) => void = () => undefined;
  const finished = new Promise<TerminalEngineEvent>((resolve) => {
    resolveFinished = resolve;
  });
  const session: SupervisedSession = {
    ownerLabel,
    openSession,
    receiveSessionEvent: (event: AgentEngineEvent) => received.push(event),
    finishSession: (event: TerminalEngineEvent) => resolveFinished(event),
  };
  return { received, finished, session };
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('AgentSessionSupervisor: failures stay inside their session', () => {
  it('a crash in one session fails that task while the other sessions keep running', async () => {
    const { supervisor } = createSupervisor();

    const crashingTask = createFakeTask('task:crash', async function* () {
      yield { kind: 'message', text: 'bắt đầu' };
      await pause(10);
      throw new TypeError('bug inside the engine adapter');
    });
    const healthyTask = createFakeTask('task:healthy', async function* () {
      for (let step = 1; step <= 5; step += 1) {
        await pause(10);
        yield { kind: 'message', text: `bước ${step}` };
      }
      yield { kind: 'completed', summary: 'xong' };
    });

    supervisor.startSupervisedSession(crashingTask.session);
    supervisor.startSupervisedSession(healthyTask.session);

    await expect(crashingTask.finished).resolves.toEqual({
      kind: 'failed',
      code: 'SESSION_CRASHED',
      message: expect.any(String),
      retryable: false,
    });
    await expect(healthyTask.finished).resolves.toEqual({ kind: 'completed', summary: 'xong' });
    expect(healthyTask.received.filter((event) => event.kind === 'message')).toHaveLength(5);

    // The supervisor still accepts work after the crash.
    const laterTask = createFakeTask('task:later', async function* () {
      yield { kind: 'completed', summary: null };
    });
    supervisor.startSupervisedSession(laterTask.session);
    await expect(laterTask.finished).resolves.toEqual({ kind: 'completed', summary: null });
  });

  it('keeps the retryable flag of AppErrors so the task can be retried', async () => {
    const { supervisor } = createSupervisor();
    const task = createFakeTask('task:retry', async function* () {
      yield* [];
      throw new EngineUnavailableError('codex not reachable');
    });

    supervisor.startSupervisedSession(task.session);

    await expect(task.finished).resolves.toMatchObject({
      kind: 'failed',
      code: 'ENGINE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('isolates a throwing owner callback and stops that session', async () => {
    const { supervisor, logger } = createSupervisor();
    let engineSawAbort = false;
    const task = createFakeTask('task:bad-owner', async function* (signal) {
      yield { kind: 'message', text: 'first' };
      await pause(10);
      engineSawAbort = signal.aborted;
      yield { kind: 'cancelled' };
    });
    const receive = task.session.receiveSessionEvent;
    task.session.receiveSessionEvent = (event) => {
      receive(event);
      if (event.kind === 'message') {
        throw new Error('owner failed to store the event');
      }
    };

    supervisor.startSupervisedSession(task.session);

    await expect(task.finished).resolves.toMatchObject({ kind: 'failed', code: 'SESSION_CRASHED' });
    expect(engineSawAbort).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('survives a rejecting finish step', async () => {
    const { supervisor, logger } = createSupervisor();
    const task = createFakeTask('task:finish', async function* () {
      yield { kind: 'completed', summary: null };
    });
    task.session.finishSession = () => Promise.reject(new Error('could not save the result'));

    supervisor.startSupervisedSession(task.session);
    await pause(20);

    expect(supervisor.countActiveSessions()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'session finish step failed');
  });

  it('reports exactly one terminal event and ends with failed when the stream stops early', async () => {
    const { supervisor } = createSupervisor();
    const task = createFakeTask('task:silent', async function* () {
      yield { kind: 'message', text: 'không có kết thúc' };
    });

    supervisor.startSupervisedSession(task.session);

    await expect(task.finished).resolves.toMatchObject({
      kind: 'failed',
      code: 'ENGINE_STREAM_ENDED',
      retryable: true,
    });
    expect(
      task.received.filter((event) => ['completed', 'failed', 'cancelled'].includes(event.kind)),
    ).toHaveLength(1);
  });

  it('cancels every session within the timeout', async () => {
    const { supervisor } = createSupervisor();
    const waitForAbort = (signal: AbortSignal) =>
      new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    const tasks = [1, 2, 3].map((index) =>
      createFakeTask(`task:${index}`, async function* (signal) {
        await waitForAbort(signal);
        yield { kind: 'cancelled' };
      }),
    );
    tasks.forEach((task) => supervisor.startSupervisedSession(task.session));

    const result = await supervisor.cancelAllSessions(1_000);

    expect(result.unfinishedOwners).toEqual([]);
    await expect(Promise.all(tasks.map((task) => task.finished))).resolves.toEqual([
      { kind: 'cancelled' },
      { kind: 'cancelled' },
      { kind: 'cancelled' },
    ]);
  });

  it('reports sessions that ignore cancellation once the timeout passes', async () => {
    const { supervisor } = createSupervisor();
    const stubborn = createFakeTask('task:stubborn', async function* () {
      await pause(500);
      yield { kind: 'completed', summary: null };
    });
    supervisor.startSupervisedSession(stubborn.session);

    const result = await supervisor.cancelAllSessions(50);

    expect(result.unfinishedOwners).toEqual(['task:stubborn']);
    await stubborn.finished;
  });
});
