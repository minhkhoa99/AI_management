import type { AgentEngineEvent } from '@aiteam/contracts';
import { AppError } from '../errors/app-error';
import type { IdGenerator } from '../identifiers/id-generator';
import type { AppLogger } from '../logging/app-logger';

export type TerminalEngineEvent = Extract<
  AgentEngineEvent,
  { kind: 'completed' | 'failed' | 'cancelled' }
>;

const TERMINAL_KINDS = new Set<AgentEngineEvent['kind']>(['completed', 'failed', 'cancelled']);

/** What the owner of a session (a task, a test run) provides to the supervisor. */
export interface SupervisedSession {
  /** For logs only, e.g. "task:T-142" or "test-run:<id>". */
  ownerLabel: string;
  openSession(signal: AbortSignal): AsyncIterable<AgentEngineEvent>;
  /** Called for every event, the terminal one included. Must not block; may throw (isolated). */
  receiveSessionEvent(event: AgentEngineEvent): void;
  /** Called once, after the session has fully ended (its process exited). Awaited; may reject. */
  finishSession(terminalEvent: TerminalEngineEvent): void | Promise<void>;
}

interface ActiveSession {
  ownerLabel: string;
  abortController: AbortController;
  completion: Promise<void>;
}

/**
 * Runs every agent session and contains its failures (CLAUDE.md, error policy): whatever an
 * engine, a stream or an owner callback throws becomes this session's single `failed` event;
 * it never reaches the process. Other sessions and the server keep running.
 */
export class AgentSessionSupervisor {
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly logger: AppLogger,
  ) {}

  startSupervisedSession(session: SupervisedSession): string {
    const sessionId = this.idGenerator.generateId();
    const abortController = new AbortController();
    const completion = this.superviseSession(sessionId, session, abortController).finally(() =>
      this.activeSessions.delete(sessionId),
    );
    this.activeSessions.set(sessionId, {
      ownerLabel: session.ownerLabel,
      abortController,
      completion,
    });
    return sessionId;
  }

  cancelSupervisedSession(sessionId: string): void {
    this.activeSessions.get(sessionId)?.abortController.abort();
  }

  countActiveSessions(): number {
    return this.activeSessions.size;
  }

  /** Aborts every session and waits until they ended or the timeout passed. */
  async cancelAllSessions(timeoutMs: number): Promise<{ unfinishedOwners: string[] }> {
    const sessions = [...this.activeSessions.values()];
    sessions.forEach((session) => session.abortController.abort());
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    await Promise.race([Promise.all(sessions.map((session) => session.completion)), timedOut]);
    clearTimeout(timer);
    return {
      unfinishedOwners: [...this.activeSessions.values()].map((session) => session.ownerLabel),
    };
  }

  /** Never rejects. */
  private async superviseSession(
    sessionId: string,
    session: SupervisedSession,
    abortController: AbortController,
  ): Promise<void> {
    let terminalEvent: TerminalEngineEvent | null = null;
    const deliverEvent = (event: AgentEngineEvent): void => {
      if (terminalEvent !== null) {
        return;
      }
      if (TERMINAL_KINDS.has(event.kind)) {
        terminalEvent = event as TerminalEngineEvent;
      }
      try {
        session.receiveSessionEvent(event);
      } catch (error) {
        this.logger.error(
          { err: error, sessionId, owner: session.ownerLabel },
          'session event receiver failed',
        );
        if (terminalEvent === null) {
          terminalEvent = describeSessionCrash(error);
          abortController.abort();
        }
      }
    };

    try {
      // Read to the natural end even after the terminal event: stopping early would kill the
      // engine process while it is still exiting.
      for await (const event of session.openSession(abortController.signal)) {
        deliverEvent(event);
      }
    } catch (error) {
      this.logger.error(
        { err: error, sessionId, owner: session.ownerLabel },
        'agent session crashed',
      );
      deliverEvent(describeSessionCrash(error));
    }
    if (terminalEvent === null) {
      deliverEvent(
        abortController.signal.aborted
          ? { kind: 'cancelled' }
          : {
              kind: 'failed',
              code: 'ENGINE_STREAM_ENDED',
              message: 'Engine dừng mà không báo kết quả.',
              retryable: true,
            },
      );
    }

    try {
      await session.finishSession(terminalEvent ?? { kind: 'cancelled' });
    } catch (error) {
      this.logger.error(
        { err: error, sessionId, owner: session.ownerLabel },
        'session finish step failed',
      );
    }
  }
}

function describeSessionCrash(error: unknown): TerminalEngineEvent {
  if (error instanceof AppError) {
    return { kind: 'failed', code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    kind: 'failed',
    code: 'SESSION_CRASHED',
    message: 'Phiên agent gặp lỗi nội bộ và đã dừng. Tra log theo traceId để biết chi tiết.',
    retryable: false,
  };
}
