import type { LiveUpdate } from '@aiteam/contracts';

/** Recent updates kept for reconnecting clients (Last-Event-ID). */
const REPLAY_CAPACITY = 2_000;

export type LiveUpdateInput = Omit<LiveUpdate, 'sequence' | 'at'>;
export type LiveUpdateListener = (update: LiveUpdate) => void;

/**
 * In-process fan-out of UI notifications (task changed, new task log line, approval changed)
 * to the open server-sent event streams. Not a domain event bus: nothing reacts to it but
 * screens. A listener that throws is removed; it never affects the publisher.
 */
export class LiveUpdateHub {
  private nextSequence = 1;
  private readonly recent: LiveUpdate[] = [];
  private readonly listeners = new Set<LiveUpdateListener>();

  publishLiveUpdate(input: LiveUpdateInput): void {
    const update: LiveUpdate = {
      ...input,
      sequence: this.nextSequence,
      at: new Date().toISOString(),
    };
    this.nextSequence += 1;
    this.recent.push(update);
    if (this.recent.length > REPLAY_CAPACITY) this.recent.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener(update);
      } catch {
        // A broken stream must not break the publisher; drop it (the client reconnects).
        this.listeners.delete(listener);
      }
    }
  }

  subscribeToLiveUpdates(listener: LiveUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Updates after `sequence` still in memory (a restart starts over, the client reloads). */
  listUpdatesSince(sequence: number): LiveUpdate[] {
    return this.recent.filter((update) => update.sequence > sequence);
  }

  countListeners(): number {
    return this.listeners.size;
  }
}
