'use client';

import { type AgentEngineEvent, engineTestRunMessageSchema } from '@aiteam/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelEngineTestRun } from './providers-api';

const TERMINAL_KINDS = new Set<AgentEngineEvent['kind']>(['completed', 'failed', 'cancelled']);

export type TestRunPhase = 'idle' | 'starting' | 'running' | 'finished';

/**
 * Starts a test run and follows its server-sent events. The stream is closed on the terminal
 * event (an EventSource would otherwise reconnect and replay); duplicates are dropped by sequence.
 */
export function useEngineTestRun() {
  const [phase, setPhase] = useState<TestRunPhase>('idle');
  const [events, setEvents] = useState<AgentEngineEvent[]>([]);
  const [startError, setStartError] = useState<unknown>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const testRunIdRef = useRef<string | null>(null);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  useEffect(() => closeStream, [closeStream]);

  const startTestRun = useCallback(
    async (startOnServer: () => Promise<{ testRunId: string }>) => {
      closeStream();
      setEvents([]);
      setStartError(null);
      setPhase('starting');
      let testRunId: string;
      try {
        testRunId = (await startOnServer()).testRunId;
      } catch (error) {
        setStartError(error);
        setPhase('idle');
        return;
      }
      testRunIdRef.current = testRunId;
      setPhase('running');
      let lastSequence = -1;
      const eventSource = new EventSource(
        `/api/engine-test-runs/${encodeURIComponent(testRunId)}/events`,
      );
      eventSourceRef.current = eventSource;
      eventSource.onmessage = (messageEvent: MessageEvent<string>) => {
        const parsed = engineTestRunMessageSchema.safeParse(JSON.parse(messageEvent.data));
        if (!parsed.success || parsed.data.sequence <= lastSequence) {
          return;
        }
        lastSequence = parsed.data.sequence;
        const engineEvent = parsed.data.event;
        setEvents((previous) => [...previous, engineEvent]);
        if (TERMINAL_KINDS.has(engineEvent.kind)) {
          closeStream();
          setPhase('finished');
        }
      };
      eventSource.onerror = () => {
        // Browser retries automatically; once the run is over the server has nothing more to send.
        if (eventSource.readyState === EventSource.CLOSED) {
          setPhase((current) => (current === 'running' ? 'finished' : current));
        }
      };
    },
    [closeStream],
  );

  const cancelTestRun = useCallback(async () => {
    if (testRunIdRef.current !== null) {
      await cancelEngineTestRun(testRunIdRef.current);
    }
  }, []);

  return { phase, events, startError, startTestRun, cancelTestRun };
}
