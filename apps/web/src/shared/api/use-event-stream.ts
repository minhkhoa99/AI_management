'use client';

import { type LiveUpdate, liveUpdateBatchSchema } from '@aiteam/contracts';
import { useEffect, useRef } from 'react';

type UpdatesListener = (updates: LiveUpdate[]) => void;

interface SharedStream {
  eventSource: EventSource;
  listeners: Set<UpdatesListener>;
  lastSequence: number;
}

/**
 * One EventSource per URL, shared by every component that follows it (the sidebar, the bell and
 * the screen all use the workspace stream): browsers allow only ~6 connections per origin.
 */
const sharedStreams = new Map<string, SharedStream>();

function openSharedStream(url: string): SharedStream {
  const stream: SharedStream = {
    eventSource: new EventSource(url),
    listeners: new Set(),
    lastSequence: 0,
  };
  stream.eventSource.onmessage = (message: MessageEvent<string>) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message.data);
    } catch {
      return; // Not ours (a proxy keep-alive); the stream goes on.
    }
    const parsed = liveUpdateBatchSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const fresh = parsed.data.items.filter((update) => update.sequence > stream.lastSequence);
    if (fresh.length === 0) return;
    stream.lastSequence = Math.max(...fresh.map((update) => update.sequence));
    for (const listener of [...stream.listeners]) listener(fresh);
  };
  return stream;
}

/**
 * Follows a live stream (/api/stream/...). EventSource reconnects by itself and sends
 * Last-Event-ID, so the server replays what was missed; duplicates are dropped by sequence.
 * `url` null: no stream. The handler always sees the latest props.
 */
export function useEventStream(
  url: string | null,
  receiveUpdates: (updates: LiveUpdate[]) => void,
): void {
  const handlerRef = useRef(receiveUpdates);
  handlerRef.current = receiveUpdates;

  useEffect(() => {
    if (url === null) return undefined;
    const stream = sharedStreams.get(url) ?? openSharedStream(url);
    sharedStreams.set(url, stream);
    const listener: UpdatesListener = (updates) => handlerRef.current(updates);
    stream.listeners.add(listener);
    return () => {
      stream.listeners.delete(listener);
      if (stream.listeners.size === 0) {
        stream.eventSource.close();
        sharedStreams.delete(url);
      }
    };
  }, [url]);
}
