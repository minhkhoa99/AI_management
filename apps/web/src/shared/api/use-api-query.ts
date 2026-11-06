'use client';

import { useCallback, useEffect, useState } from 'react';

export type ApiQueryState<Result> =
  { status: 'loading' } | { status: 'success'; result: Result } | { status: 'error'; error: Error };

/**
 * Loads a value once per mount and exposes loading / success / error states.
 * `queryKey` identifies the request: changing it reloads. SSE-driven refresh comes in phase 4.
 */
export function useApiQuery<Result>(
  queryKey: string,
  loadResult: () => Promise<Result>,
): ApiQueryState<Result> & { reload: () => void } {
  const [state, setState] = useState<ApiQueryState<Result>>({ status: 'loading' });
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setState({ status: 'loading' });
    loadResult().then(
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
    // loadResult changes identity on every render by design; queryKey identifies the request.
  }, [queryKey, reloadCounter]);

  const reload = useCallback(() => setReloadCounter((counter) => counter + 1), []);
  return { ...state, reload };
}
