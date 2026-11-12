'use client';

import type { EngineQuotaReport } from '@aiteam/contracts';
import { useCallback, useSyncExternalStore } from 'react';
import { useEventStream } from '../../shared/api/use-event-stream';
import { loadEngineQuotas, refreshEngineQuotas } from './providers-api';

/** Re-render period: keeps "cập nhật N phút trước" right; also re-reads the server cache. */
const TICK_MILLISECONDS = 60_000;

interface QuotaState {
  reports: EngineQuotaReport[] | null;
  refreshing: boolean;
  /** Why the last manual refresh failed; cleared by the next success. */
  refreshError: string | null;
  /** Wall clock of the last change, so components can show relative times without own timers. */
  now: number;
}

let state: QuotaState = { reports: null, refreshing: false, refreshError: null, now: 0 };
const listeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let pendingLoad: Promise<void> | null = null;

function updateState(changes: Partial<QuotaState>): void {
  state = { ...state, ...changes, now: Date.now() };
  for (const listener of [...listeners]) listener();
}

/** One request at a time: many components asking at once share the same load. */
function reloadEngineQuotas(): Promise<void> {
  pendingLoad ??= loadEngineQuotas()
    .then((reports) => updateState({ reports }))
    .catch((error: unknown) => {
      // Keep the numbers we have; the footer ages and the next tick or stream event retries.
      console.warn('Không tải được hạn mức engine', error);
      updateState({});
    })
    .finally(() => {
      pendingLoad = null;
    });
  return pendingLoad;
}

async function refreshQuotasNow(): Promise<void> {
  if (state.refreshing) return;
  updateState({ refreshing: true, refreshError: null });
  try {
    updateState({ reports: await refreshEngineQuotas(), refreshing: false });
  } catch (error: unknown) {
    console.warn('Không đọc lại được hạn mức engine', error);
    updateState({ refreshing: false, refreshError: 'Không đọc lại được hạn mức.' });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void reloadEngineQuotas();
    tickTimer = setInterval(() => {
      void reloadEngineQuotas();
    }, TICK_MILLISECONDS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const getSnapshot = (): QuotaState => state;
const getServerSnapshot = (): QuotaState => state;

export function useEngineQuotas(): {
  reports: EngineQuotaReport[] | null;
  refresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
  now: number;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // The workspace stream is shared by URL; reloads from several hook users merge in one request.
  useEventStream('/api/stream/workspace', (updates) => {
    if (updates.some((update) => update.type === 'engine_quota.changed')) {
      void reloadEngineQuotas();
    }
  });
  const refresh = useCallback(() => {
    void refreshQuotasNow();
  }, []);
  return {
    reports: snapshot.reports,
    refresh,
    refreshing: snapshot.refreshing,
    refreshError: snapshot.refreshError,
    now: snapshot.now,
  };
}
