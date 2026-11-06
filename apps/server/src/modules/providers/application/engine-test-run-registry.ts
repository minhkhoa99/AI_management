import { Inject, Injectable } from '@nestjs/common';
import type { AgentEngineEvent, EngineTestRunMessage } from '@aiteam/contracts';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../shared/identifiers/id-generator';
import { APP_LOGGER, type AppLogger } from '../../../shared/logging/app-logger';
import {
  AgentSessionSupervisor,
  type TerminalEngineEvent,
} from '../../../shared/runtime/agent-session-supervisor';

const TEST_RUN_TIMEOUT_MS = 3 * 60_000;
const FINISHED_RUN_RETENTION_MS = 10 * 60_000;
const MAX_BUFFERED_EVENTS = 500;

type TestRunListener = (message: EngineTestRunMessage) => void;

interface TestRunRecord {
  targetKey: string;
  sessionId: string | null;
  messages: EngineTestRunMessage[];
  finished: boolean;
  listeners: Set<TestRunListener>;
  finishListeners: Set<() => void>;
}

/**
 * In-memory test runs ("Chạy thử"): one at a time per engine or connection, buffered so a
 * browser connecting late still receives every event, cancelled after a timeout, forgotten a
 * few minutes after finishing. Each run is a session of the AgentSessionSupervisor, so its
 * failures stay inside the run.
 */
@Injectable()
export class EngineTestRunRegistry {
  private readonly testRuns = new Map<string, TestRunRecord>();

  constructor(
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly sessionSupervisor: AgentSessionSupervisor,
  ) {}

  startEngineTestRun(
    targetKey: string,
    openSession: (signal: AbortSignal) => AsyncIterable<AgentEngineEvent>,
    releaseResources: () => void,
  ): string {
    const running = [...this.testRuns.values()].some(
      (testRun) => testRun.targetKey === targetKey && !testRun.finished,
    );
    if (running) {
      throw new ConflictError('Đang có một lần chạy thử cho mục này. Chờ xong hoặc huỷ trước.', {
        code: 'TEST_RUN_IN_PROGRESS',
      });
    }
    const testRunId = this.idGenerator.generateId();
    const record: TestRunRecord = {
      targetKey,
      sessionId: null,
      messages: [],
      finished: false,
      listeners: new Set(),
      finishListeners: new Set(),
    };
    this.testRuns.set(testRunId, record);
    const timeout = setTimeout(() => this.cancelEngineTestRun(testRunId), TEST_RUN_TIMEOUT_MS);
    record.sessionId = this.sessionSupervisor.startSupervisedSession({
      ownerLabel: `test-run:${testRunId}`,
      openSession,
      receiveSessionEvent: (event) => this.publishTestRunEvent(record, event),
      finishSession: (terminalEvent) => {
        clearTimeout(timeout);
        this.completeTestRun(testRunId, record, terminalEvent, releaseResources);
      },
    });
    return testRunId;
  }

  /** Throws NotFound for an unknown or expired test run. */
  assertEngineTestRunExists(testRunId: string): void {
    this.requireTestRun(testRunId);
  }

  cancelEngineTestRun(testRunId: string): void {
    const record = this.requireTestRun(testRunId);
    if (record.sessionId !== null) {
      this.sessionSupervisor.cancelSupervisedSession(record.sessionId);
    }
  }

  /** Replays buffered messages, then streams new ones; `onFinish` fires once at the end. */
  followEngineTestRun(
    testRunId: string,
    listener: TestRunListener,
    onFinish: () => void,
  ): () => void {
    const record = this.requireTestRun(testRunId);
    record.messages.forEach(listener);
    if (record.finished) {
      onFinish();
      return () => undefined;
    }
    record.listeners.add(listener);
    record.finishListeners.add(onFinish);
    return () => {
      record.listeners.delete(listener);
      record.finishListeners.delete(onFinish);
    };
  }

  private completeTestRun(
    testRunId: string,
    record: TestRunRecord,
    terminalEvent: TerminalEngineEvent,
    releaseResources: () => void,
  ): void {
    record.finished = true;
    this.logger.info(
      { testRunId, targetKey: record.targetKey, outcome: terminalEvent.kind },
      'engine test run finished',
    );
    record.finishListeners.forEach((notifyFinished) => notifyFinished());
    record.listeners.clear();
    record.finishListeners.clear();
    this.releaseTestRunResources(testRunId, releaseResources);
    setTimeout(() => this.testRuns.delete(testRunId), FINISHED_RUN_RETENTION_MS).unref();
  }

  /** Cleanup failures are logged; they must never take the server down. */
  private releaseTestRunResources(testRunId: string, releaseResources: () => void): void {
    try {
      releaseResources();
    } catch (error) {
      this.logger.warn(
        { testRunId, err: error },
        'engine test run resources could not be released',
      );
    }
  }

  private publishTestRunEvent(record: TestRunRecord, event: AgentEngineEvent): void {
    const message = { sequence: record.messages.length, event };
    const isTerminal =
      event.kind === 'completed' || event.kind === 'failed' || event.kind === 'cancelled';
    if (record.messages.length < MAX_BUFFERED_EVENTS || isTerminal) {
      record.messages.push(message);
    }
    record.listeners.forEach((listener) => listener(message));
  }

  private requireTestRun(testRunId: string): TestRunRecord {
    const record = this.testRuns.get(testRunId);
    if (record === undefined) {
      throw new NotFoundError('Không tìm thấy lần chạy thử (có thể đã quá hạn).', {
        code: 'TEST_RUN_NOT_FOUND',
      });
    }
    return record;
  }
}
