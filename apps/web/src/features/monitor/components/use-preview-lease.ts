'use client';

import { useEffect, useRef, useState } from 'react';
import type { PreviewStatus } from '@aiteam/contracts';
import { startPreview, stopPreview } from '../monitor-api';

const STARTING_POLL_MS = 1_500;
/** Well inside the server lease (45 s), so a slow request never lets the preview lapse. */
const RENEW_MS = 10_000;

const STOPPED: PreviewStatus = {
  state: 'stopped',
  url: null,
  port: null,
  message: null,
  output: '',
};

/**
 * Keeps the task's preview server running while the tab is shown: starts it, renews its lease,
 * and stops it when the tab closes. A closed browser tab simply stops renewing; the server
 * then stops on its own when the lease runs out.
 */
export function usePreviewLease(taskId: string, command: string) {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const controls = useRef({ restartPreview: () => {}, stopPreviewNow: () => {} });

  useEffect(() => {
    let isLeased = true;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;

    // Never rejects: failures are kept in state and the next renewal tries again.
    const renewPreview = async (restart: boolean): Promise<void> => {
      clearTimeout(renewTimer);
      try {
        const next = await startPreview(taskId, restart);
        if (!isLeased) return;
        setStatus(next);
        setFailure(null);
        renewTimer = setTimeout(
          () => void renewPreview(false),
          next.state === 'starting' ? STARTING_POLL_MS : RENEW_MS,
        );
      } catch (error) {
        if (!isLeased) return;
        setFailure(error);
        renewTimer = setTimeout(() => void renewPreview(false), RENEW_MS);
      }
    };

    const releasePreview = () => {
      if (!isLeased) return;
      isLeased = false;
      clearTimeout(renewTimer);
      stopPreview(taskId).catch((error: unknown) => {
        // Not fatal: the server stops the preview anyway once its lease runs out.
        console.warn('Không dừng được bản xem trước', error);
      });
    };

    controls.current = {
      restartPreview: () => {
        isLeased = true;
        setStatus((previous) => (previous === null ? null : { ...previous, state: 'starting' }));
        void renewPreview(true);
      },
      stopPreviewNow: () => {
        releasePreview();
        setStatus(STOPPED);
      },
    };
    void renewPreview(false);
    return releasePreview;
  }, [taskId, command]);

  return {
    status,
    failure,
    restartPreview: () => controls.current.restartPreview(),
    stopPreviewNow: () => controls.current.stopPreviewNow(),
  };
}
