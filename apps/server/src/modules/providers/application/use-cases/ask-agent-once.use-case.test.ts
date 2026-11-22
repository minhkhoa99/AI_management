import type { AgentEngineEvent } from '@aiteam/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../../../../shared/logging/app-logger';
import { AgentSessionSupervisor } from '../../../../shared/runtime/agent-session-supervisor';
import type { EngineSnapshot } from '../../../orchestration/domain/entities/task';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../../../orchestration/application/ports/agent-engine.port';
import { EngineTestRunRegistry } from '../engine-test-run-registry';
import { AskAgentOnceUseCase } from './ask-agent-once.use-case';

const EDITING_ONLINE_SNAPSHOT: EngineSnapshot = {
  agentId: 'a1',
  provider: 'claude_code',
  connectionId: null,
  model: 'sonnet',
  accessLevel: 'edit_workspace',
  networkAccess: true,
};

type SessionScript = (signal: AbortSignal) => AsyncGenerator<AgentEngineEvent>;

function createRunner(script: SessionScript) {
  let nextId = 0;
  // Computed key: "info" is pino's method name, not one of our identifiers.
  const logger = { ['info']: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  const idGenerator = { generateId: () => `id-${(nextId += 1)}` };
  const registry = new EngineTestRunRegistry(
    idGenerator,
    logger,
    new AgentSessionSupervisor(idGenerator, logger),
  );
  const engineRequests: AgentSessionRequest[] = [];
  const engine = {
    startSession: (request: AgentSessionRequest, signal: AbortSignal) => {
      engineRequests.push(request);
      return script(signal);
    },
  } as unknown as AgentEnginePort;
  const preparer = {
    prepareAgentRun: vi.fn(() => ({
      engine,
      model: 'sonnet',
      permissions: {
        accessLevel: 'read_only' as const,
        networkAccess: false,
        blockDangerousCommands: true,
      },
      apiConnection: null,
    })),
  };
  const dispose = vi.fn();
  const factory = {
    createSampleWorkspace: vi.fn(() => ({
      directory: '/tmp/sample',
      disposeSampleWorkspace: dispose,
    })),
  };
  const runner = new AskAgentOnceUseCase(preparer, factory, registry);
  return { runner, preparer, factory, dispose, engineRequests, registry };
}

function sessionEnding(...events: AgentEngineEvent[]): SessionScript {
  return async function* scriptedSession() {
    await Promise.resolve();
    yield* events;
  };
}

describe('AskAgentOnceUseCase', () => {
  it('runs read-only and offline in an empty throw-away folder and returns the final summary', async () => {
    const { runner, preparer, factory, dispose, engineRequests } = createRunner(
      sessionEnding(
        { kind: 'message', text: 'đang nghĩ' },
        { kind: 'completed', summary: 'kết quả' },
      ),
    );

    await expect(
      runner.askAgentOnce({
        snapshot: EDITING_ONLINE_SNAPSHOT,
        prompt: 'p',
        runKey: 'workflow-ai:d1',
      }),
    ).resolves.toBe('kết quả');
    expect(preparer.prepareAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ accessLevel: 'read_only', networkAccess: false }),
    );
    expect(factory.createSampleWorkspace).toHaveBeenCalledWith({ withReadme: false });
    expect(engineRequests[0]).toMatchObject({
      prompt: 'p',
      workingDirectory: '/tmp/sample',
      workspaceRoot: null,
      resumeSessionRef: null,
    });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it('falls back to the last message when the summary is null', async () => {
    const { runner } = createRunner(
      sessionEnding(
        { kind: 'message', text: 'đầu' },
        { kind: 'message', text: 'cuối' },
        { kind: 'completed', summary: null },
      ),
    );

    await expect(
      runner.askAgentOnce({ snapshot: EDITING_ONLINE_SNAPSHOT, prompt: 'p', runKey: 'k' }),
    ).resolves.toBe('cuối');
  });

  it.each<[AgentEngineEvent, string]>([
    [{ kind: 'failed', code: 'RATE_LIMITED', message: 'm', retryable: true }, 'RATE_LIMITED'],
    [
      { kind: 'failed', code: 'ENGINE_UNAVAILABLE', message: 'm', retryable: true },
      'ENGINE_UNAVAILABLE',
    ],
    [
      { kind: 'failed', code: 'ENGINE_AUTH_FAILED', message: 'm', retryable: false },
      'ENGINE_AUTH_FAILED',
    ],
    [{ kind: 'cancelled' }, 'AI_PROPOSAL_TIMEOUT'],
  ])('maps %o to %s', async (terminalEvent, code) => {
    const { runner } = createRunner(sessionEnding(terminalEvent));

    await expect(
      runner.askAgentOnce({ snapshot: EDITING_ONLINE_SNAPSHOT, prompt: 'p', runKey: 'k' }),
    ).rejects.toMatchObject({ code });
  });

  it('refuses a second run with the same key and disposes its folder', async () => {
    const { runner, dispose, registry } = createRunner(async function* neverEnding(signal) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      yield { kind: 'cancelled' };
    });
    const first = runner.askAgentOnce({
      snapshot: EDITING_ONLINE_SNAPSHOT,
      prompt: 'p',
      runKey: 'workflow-ai:d1',
    });

    await expect(
      runner.askAgentOnce({
        snapshot: EDITING_ONLINE_SNAPSHOT,
        prompt: 'p',
        runKey: 'workflow-ai:d1',
      }),
    ).rejects.toMatchObject({
      code: 'TEST_RUN_IN_PROGRESS',
      message: 'Đang có một lượt chạy cho mục này. Chờ xong hoặc huỷ trước.',
    });
    expect(dispose).toHaveBeenCalledTimes(1);

    registry.cancelEngineTestRun('id-1');
    await expect(first).rejects.toMatchObject({ code: 'AI_PROPOSAL_TIMEOUT' });
  });
});
