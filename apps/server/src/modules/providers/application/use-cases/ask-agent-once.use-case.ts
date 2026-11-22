import { Inject, Injectable } from '@nestjs/common';
import {
  EngineAuthError,
  EngineUnavailableError,
  RateLimitedError,
} from '../../../../shared/errors/app-error';
import type { TerminalEngineEvent } from '../../../../shared/runtime/agent-session-supervisor';
import {
  AGENT_RUN_PREPARER,
  type AgentRunPreparer,
  type OneShotAgentRunner,
} from '../../../orchestration/application/ports/task-execution.ports';
import type { EngineSnapshot } from '../../../orchestration/domain/entities/task';
import { EngineTestRunRegistry } from '../engine-test-run-registry';
import {
  SAMPLE_WORKSPACE_FACTORY,
  type SampleWorkspaceFactory,
} from '../ports/sample-workspace.port';

/**
 * One question to an agent, answered once (workflow drafts and proposals): read-only, offline,
 * in an empty throw-away folder, through the test-run registry (3-minute limit, one run per
 * key). Never logs the prompt or the answer; never waits for quota.
 */
@Injectable()
export class AskAgentOnceUseCase implements OneShotAgentRunner {
  constructor(
    @Inject(AGENT_RUN_PREPARER) private readonly runPreparer: AgentRunPreparer,
    @Inject(SAMPLE_WORKSPACE_FACTORY) private readonly workspaceFactory: SampleWorkspaceFactory,
    private readonly testRunRegistry: EngineTestRunRegistry,
  ) {}

  // async: a refused start (TEST_RUN_IN_PROGRESS) rejects instead of throwing synchronously.
  async askAgentOnce(request: {
    snapshot: EngineSnapshot;
    prompt: string;
    runKey: string;
  }): Promise<string> {
    const { engine, model, permissions, apiConnection } = this.runPreparer.prepareAgentRun({
      ...request.snapshot,
      accessLevel: 'read_only',
      networkAccess: false,
    });
    const workspace = this.workspaceFactory.createSampleWorkspace({ withReadme: false });
    let testRunId: string;
    try {
      testRunId = this.testRunRegistry.startEngineTestRun(
        request.runKey,
        (signal) =>
          engine.startSession(
            {
              prompt: request.prompt,
              workingDirectory: workspace.directory,
              workspaceRoot: null,
              model,
              permissions,
              resumeSessionRef: null,
              apiConnection,
            },
            signal,
          ),
        () => workspace.disposeSampleWorkspace(),
      );
    } catch (error) {
      workspace.disposeSampleWorkspace();
      throw error;
    }
    return new Promise((resolve, reject) => {
      let lastMessage: string | null = null;
      let terminalEvent: TerminalEngineEvent | null = null;
      this.testRunRegistry.followEngineTestRun(
        testRunId,
        ({ event }) => {
          if (event.kind === 'message') {
            lastMessage = event.text;
          } else if (
            event.kind === 'completed' ||
            event.kind === 'failed' ||
            event.kind === 'cancelled'
          ) {
            terminalEvent = event;
          }
        },
        () => {
          // The supervisor always ends a session with a terminal event; cancelled covers the rest.
          const outcome: TerminalEngineEvent = terminalEvent ?? { kind: 'cancelled' };
          if (outcome.kind === 'completed') {
            resolve(outcome.summary ?? lastMessage ?? '');
          } else {
            reject(describeUnansweredQuestion(outcome));
          }
        },
      );
    });
  }
}

function describeUnansweredQuestion(
  outcome: Exclude<TerminalEngineEvent, { kind: 'completed' }>,
): Error {
  if (outcome.kind === 'cancelled') {
    return new EngineUnavailableError('AI không trả lời trong 3 phút.', {
      code: 'AI_PROPOSAL_TIMEOUT',
    });
  }
  if (outcome.code === 'RATE_LIMITED') {
    return new RateLimitedError(outcome.message, 0);
  }
  return outcome.retryable
    ? new EngineUnavailableError(outcome.message)
    : new EngineAuthError(outcome.message, { code: outcome.code });
}
