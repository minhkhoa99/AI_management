import { Inject, Injectable } from '@nestjs/common';
import type { AgentEngineEvent, EngineTestRunMessage } from '@aiteam/contracts';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../shared/identifiers/id-generator';
import { APP_LOGGER, type AppLogger } from '../../../shared/logging/app-logger';

const TEST_RUN_TIMEOUT_MS = 3 * 60_000;
const FINISHED_RUN_RETENTION_MS = 10 * 60_000;
const MAX_BUFFERED_EVENTS = 500;
const TERMINAL_EVENT_KINDS = new Set<AgentEngineEvent['kind']>([
  'completed',
  'failed',
  'cancelled',
]);

type TestRunListener = (message: EngineTestRunMessage) => void;

interface TestRunRecord {
  targetKey: string;
  messages: EngineTestRunMessage[];
  finished: boolean;
  abortController: AbortController;
  listeners: Set<TestRunListener>;
  finishListeners: Set<() => void>;
}

/**
 * In-memory test runs ("Chạy thử"): one at a time per engine or connection, buffered so a
 * browser connecting late still receives every event, cancelled after a timeout, forgotten
 * a few minutes after finishing.
 */
@Injectable()
export class EngineTestRunRegistry {
  private readonly testRuns = new Map<string, TestRunRecord>();

  constructor(
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
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
      messages: [],
      finished: false,
      abortController: new AbortController(),
      listeners: new Set(),
      finishListeners: new Set(),
    };
    this.testRuns.set(testRunId, record);
    const timeout = setTimeout(() => record.abortController.abort(), TEST_RUN_TIMEOUT_MS);
    void this.consumeSession(testRunId, record, openSession).finally(() => {
      clearTimeout(timeout);
      this.releaseTestRunResources(testRunId, releaseResources);
    });
    return testRunId;
  }

  /** Throws NotFound for an unknown or expired test run. */
  assertEngineTestRunExists(testRunId: string): void {
    this.requireTestRun(testRunId);
  }

  cancelEngineTestRun(testRunId: string): void {
    this.requireTestRun(testRunId).abortController.abort();
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

  private async consumeSession(
    testRunId: string,
    record: TestRunRecord,
    openSession: (signal: AbortSignal) => AsyncIterable<AgentEngineEvent>,
  ): Promise<void> {
    let lastEvent: AgentEngineEvent | undefined;
    try {
      // Read the session to its natural end even after the terminal event: breaking out early
      // would kill the CLI while it is still exiting, and its working directory stays locked.
      for await (const event of openSession(record.abortController.signal)) {
        if (lastEvent !== undefined && TERMINAL_EVENT_KINDS.has(lastEvent.kind)) {
          continue;
        }
        lastEvent = event;
        this.publishTestRunEvent(record, event);
      }
    } catch (error) {
      this.logger.error({ err: error, testRunId }, 'engine test run crashed');
      lastEvent = {
        kind: 'failed',
        code: 'INTERNAL_ERROR',
        message: 'Lỗi nội bộ khi chạy thử.',
        retryable: false,
      };
      this.publishTestRunEvent(record, lastEvent);
    }
    if (lastEvent === undefined || !TERMINAL_EVENT_KINDS.has(lastEvent.kind)) {
      lastEvent = record.abortController.signal.aborted
        ? { kind: 'cancelled' }
        : {
            kind: 'failed',
            code: 'ENGINE_STREAM_ENDED',
            message: 'Engine dừng mà không báo kết quả.',
            retryable: true,
          };
      this.publishTestRunEvent(record, lastEvent);
    }
    record.finished = true;
    this.logger.info(
      { testRunId, targetKey: record.targetKey, outcome: lastEvent.kind },
      'engine test run finished',
    );
    record.finishListeners.forEach((notifyFinished) => notifyFinished());
    record.listeners.clear();
    record.finishListeners.clear();
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
    if (record.messages.length < MAX_BUFFERED_EVENTS || TERMINAL_EVENT_KINDS.has(event.kind)) {
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
