'use client';

import { useEffect } from 'react';
import { captureSessionTokenFromUrl } from '../api/api-client';

/** Moves the ?token= handed over by the launcher into storage, once, on first load. */
export function SessionTokenCapture() {
  useEffect(() => {
    captureSessionTokenFromUrl();
  }, []);
  return null;
}
