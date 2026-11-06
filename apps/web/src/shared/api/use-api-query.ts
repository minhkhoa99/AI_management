'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ApiQueryState<Result> =
  { status: 'loading' } | { status: 'success'; result: Result } | { status: 'error'; error: Error };

/** Reload callbacks of every mounted query, so a successful write can refresh the screen. */
const mountedQueryReloaders = new Set<() => void>();

/**
 * Re-runs every mounted query. Called after each successful write; with a handful of queries on
 * screen this is simpler and safer than tracking which keys a write affects (SSE in phase 4).
 */
export function invalidateApiQueries(): void {
  for (const reloadQuery of mountedQueryReloaders) {
    reloadQuery();
  }
}

/**
 * Loads a value and exposes loading / success / error states. `queryKey` identifies the request:
 * changing it reloads. While refreshing, the previous result stays on screen (no flicker).
 */
export function useApiQuery<Result>(
  queryKey: string,
  loadResult: () => Promise<Result>,
): ApiQueryState<Result> & { reload: () => void } {
  const [state, setState] = useState<ApiQueryState<Result>>({ status: 'loading' });
  const [reloadCounter, setReloadCounter] = useState(0);
  const latestLoadResult = useRef(loadResult);
  latestLoadResult.current = loadResult;
  const lastLoadedKey = useRef<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    const isSameQuery = lastLoadedKey.current === queryKey;
    lastLoadedKey.current = queryKey;
    // A refresh of the same query keeps the old result; a different query starts clean.
    setState((previous) =>
      isSameQuery && previous.status === 'success' ? previous : { status: 'loading' },
    );
    latestLoadResult.current().then(
      (result) => {
        if (isCurrent) setState({ status: 'success', result });
      },
      (error: unknown) => {
        if (isCurrent) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [queryKey, reloadCounter]);

  const reload = useCallback(() => setReloadCounter((counter) => counter + 1), []);

  useEffect(() => {
    mountedQueryReloaders.add(reload);
    return () => {
      mountedQueryReloaders.delete(reload);
    };
  }, [reload]);

  return { ...state, reload };
}
