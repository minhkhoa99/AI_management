'use client';

import { useEffect } from 'react';

/**
 * Re-runs `reload` every `intervalMs` while `active` is true (agents at work). Replaced by
 * server-sent events in phase 4.
 */
export function useReloadWhile(active: boolean, reload: () => void, intervalMs: number): void {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(reload, intervalMs);
    return () => clearInterval(timer);
  }, [active, reload, intervalMs]);
}
