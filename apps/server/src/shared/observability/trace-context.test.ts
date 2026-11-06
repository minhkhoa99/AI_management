import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createAppLogger } from '../logging/app-logger';
import {
  createTraceId,
  getCurrentTraceContext,
  isAcceptableTraceId,
  runWithTraceContext,
  runWithTraceSubject,
} from './trace-context';

describe('trace context', () => {
  it('is undefined outside any request', () => {
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it('survives awaits, timers and promise chains', async () => {
    const observedTraceIds = await runWithTraceContext({ traceId: 'trace-async-1' }, async () => {
      const seen: Array<string | undefined> = [getCurrentTraceContext()?.traceId];
      await delay(5);
      seen.push(getCurrentTraceContext()?.traceId);
      await Promise.resolve().then(() => seen.push(getCurrentTraceContext()?.traceId));
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          seen.push(getCurrentTraceContext()?.traceId);
          resolve();
        }, 1),
      );
      return seen;
    });

    expect(observedTraceIds).toEqual([
      'trace-async-1',
      'trace-async-1',
      'trace-async-1',
      'trace-async-1',
    ]);
  });

  it('keeps concurrent requests isolated', async () => {
    const readTraceIdAfter = (traceId: string, waitMs: number) =>
      runWithTraceContext({ traceId }, async () => {
        await delay(waitMs);
        return getCurrentTraceContext()?.traceId;
      });

    const results = await Promise.all([
      readTraceIdAfter('trace-a', 15),
      readTraceIdAfter('trace-b', 1),
      readTraceIdAfter('trace-c', 8),
    ]);

    expect(results).toEqual(['trace-a', 'trace-b', 'trace-c']);
  });

  it('adds task and agent ids without losing the parent traceId', async () => {
    const context = await runWithTraceContext({ traceId: 'trace-parent' }, () =>
      runWithTraceSubject({ taskId: 'T-1', agentId: 'agent-7' }, async () => {
        await delay(1);
        return getCurrentTraceContext();
      }),
    );

    expect(context).toEqual({ traceId: 'trace-parent', taskId: 'T-1', agentId: 'agent-7' });
  });

  it('creates acceptable trace ids and rejects unsafe client-supplied ones', () => {
    expect(isAcceptableTraceId(createTraceId())).toBe(true);
    expect(isAcceptableTraceId('short')).toBe(false);
    expect(isAcceptableTraceId('abc\ninjected-log-line')).toBe(false);
    expect(isAcceptableTraceId(['trace-array-value'])).toBe(false);
  });
});

describe('logger trace propagation', () => {
  it('stamps traceId on log lines written inside an async trace context', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const logger = createAppLogger({ level: 'info', destinationStream: sink });

    await runWithTraceContext({ traceId: 'trace-log-1' }, async () => {
      await delay(1);
      logger.info('inside request');
    });
    logger.info('outside request');

    const [inside, outside] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(inside).toMatchObject({ level: 'info', msg: 'inside request', traceId: 'trace-log-1' });
    expect(outside).not.toHaveProperty('traceId');
  });
});
