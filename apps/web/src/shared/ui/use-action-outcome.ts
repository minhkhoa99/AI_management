'use client';

import { useCallback, useState } from 'react';

export type ActionOutcome =
  { tone: 'success'; message: string } | { tone: 'error'; error: unknown } | null;

/**
 * Runs one user action at a time and records its outcome for <StatusNotice>. Errors are kept and
 * shown (never swallowed); the promise resolves to undefined on failure so callers can branch.
 */
export function useActionOutcome() {
  const [outcome, setOutcome] = useState<ActionOutcome>(null);
  const [isPending, setIsPending] = useState(false);

  const performAction = useCallback(
    async <Result>(
      startAction: () => Promise<Result>,
      describeSuccess: (result: Result) => string | null,
    ): Promise<Result | undefined> => {
      setIsPending(true);
      setOutcome(null);
      try {
        const result = await startAction();
        const successMessage = describeSuccess(result);
        setOutcome(successMessage === null ? null : { tone: 'success', message: successMessage });
        return result;
      } catch (error) {
        setOutcome({ tone: 'error', error });
        return undefined;
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  const clearOutcome = useCallback(() => setOutcome(null), []);

  return { outcome, isPending, performAction, clearOutcome };
}
