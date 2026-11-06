import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Correlation ids carried through every async call made while serving one request or task. */
export interface TraceContext {
  traceId: string;
  taskId?: string;
  agentId?: string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/** Client-supplied trace ids are accepted only when they look like an opaque id (no injection). */
const ACCEPTABLE_TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function createTraceId(): string {
  return randomUUID();
}

export function isAcceptableTraceId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && ACCEPTABLE_TRACE_ID_PATTERN.test(candidate);
}

export function runWithTraceContext<T>(context: TraceContext, callback: () => T): T {
  return traceContextStorage.run({ ...context }, callback);
}

export function getCurrentTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

/** Runs the callback in a child context that keeps the current traceId and adds task/agent ids. */
export function runWithTraceSubject<T>(
  subject: Pick<TraceContext, 'taskId' | 'agentId'>,
  callback: () => T,
): T {
  const parentContext = getCurrentTraceContext();
  return runWithTraceContext(
    { traceId: parentContext?.traceId ?? createTraceId(), ...parentContext, ...subject },
    callback,
  );
}
