import type { AgentEngineEvent } from '@aiteam/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../../../shared/logging/app-logger';
import { AgentSessionSupervisor } from '../../../shared/runtime/agent-session-supervisor';
import { EngineTestRunRegistry } from './engine-test-run-registry';

function createRegistry() {
  let nextId = 0;
  // Computed key: "info" is pino's method name, not one of our identifiers.
  const logger = { ['info']: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  const idGenerator = { generateId: () => `id-${(nextId += 1)}` };
  const registry = new EngineTestRunRegistry(
    idGenerator,
    logger,
    new AgentSessionSupervisor(idGenerator, logger),
  );
  return { registry, logger };
}

function waitForFinish(
  registry: EngineTestRunRegistry,
  testRunId: string,
): Promise<AgentEngineEvent[]> {
  return new Promise((resolve) => {
    const events: AgentEngineEvent[] = [];
    registry.followEngineTestRun(
      testRunId,
      (message) => events.push(message.event),
      () => resolve(events),
    );
  });
}

describe('EngineTestRunRegistry', () => {
  // Regression: resources (the temp directory the CLI runs in) were released as soon as the
  // terminal event arrived, while the CLI process was still exiting. On Windows the directory
  // removal failed with EBUSY and the unhandled rejection crashed the whole server.
  it('releases resources only after the engine session has fully ended', async () => {
    const { registry } = createRegistry();
    const order: string[] = [];
    async function* sessionThatCleansUpAfterTerminalEvent(): AsyncGenerator<AgentEngineEvent> {
      try {
        yield { kind: 'completed', summary: 'xong' };
        order.push('engine kept running after terminal event');
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('engine process exited');
      }
    }

    const testRunId = registry.startEngineTestRun(
      'local:claude_code',
      sessionThatCleansUpAfterTerminalEvent,
      () => order.push('resources released'),
    );
    await waitForFinish(registry, testRunId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(order).toEqual([
      'engine kept running after terminal event',
      'engine process exited',
      'resources released',
    ]);
  });

  it('logs a failing resource release instead of crashing the process', async () => {
    const { registry, logger } = createRegistry();
    async function* completedSession(): AsyncGenerator<AgentEngineEvent> {
      yield { kind: 'completed', summary: null };
    }

    const testRunId = registry.startEngineTestRun('local:codex', completedSession, () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), { code: 'EBUSY' });
    });
    await waitForFinish(registry, testRunId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ testRunId, err: expect.any(Error) }),
      'engine test run resources could not be released',
    );
  });

  it('ignores events after the terminal one and keeps a single terminal event', async () => {
    const { registry } = createRegistry();
    async function* chattySession(): AsyncGenerator<AgentEngineEvent> {
      yield { kind: 'message', text: 'a' };
      yield { kind: 'completed', summary: 'a' };
      yield { kind: 'message', text: 'late' };
    }

    const events = await waitForFinish(
      registry,
      registry.startEngineTestRun('x', chattySession, () => undefined),
    );

    expect(events).toEqual([
      { kind: 'message', text: 'a' },
      { kind: 'completed', summary: 'a' },
    ]);
  });

  it('refuses a second run for the same target while one is running', () => {
    const { registry } = createRegistry();
    async function* neverEnding(signal: AbortSignal): AsyncGenerator<AgentEngineEvent> {
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      yield { kind: 'cancelled' };
    }

    const first = registry.startEngineTestRun(
      'local:codex',
      (signal) => neverEnding(signal),
      () => undefined,
    );

    expect(() =>
      registry.startEngineTestRun(
        'local:codex',
        (signal) => neverEnding(signal),
        () => undefined,
      ),
    ).toThrow(expect.objectContaining({ code: 'TEST_RUN_IN_PROGRESS' }));
    registry.cancelEngineTestRun(first);
  });
});
