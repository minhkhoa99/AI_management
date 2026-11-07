import type { WorkflowStepState } from './entities/workflow';

export type StepDecision =
  /** Gate met: go to the next step, or finish the task when nextStepId is null. */
  | { kind: 'advance'; nextStepId: string | null }
  /** Gate not met, retries left: same step again with the feedback. */
  | { kind: 'retry_step' }
  /** Gate not met: back to an earlier step (its own retry count starts over). */
  | { kind: 'return_to_step'; stepId: string }
  /** Gate not met and nothing else to try: the task fails and the manager is told. */
  | { kind: 'stop'; reason: string };

/** What happens after the gate of `currentStepId` was evaluated. */
export function decideNextStep(
  steps: readonly WorkflowStepState[],
  currentStepId: string,
  gatePassed: boolean,
  retriesUsed: number,
): StepDecision {
  const index = steps.findIndex((step) => step.id === currentStepId);
  const step = steps[index];
  if (step === undefined) {
    return { kind: 'stop', reason: 'Bước hiện tại không còn trong quy trình.' };
  }
  if (gatePassed) {
    return { kind: 'advance', nextStepId: steps[index + 1]?.id ?? null };
  }
  switch (step.onFail) {
    case 'retry':
      return retriesUsed < step.maxRetries
        ? { kind: 'retry_step' }
        : {
            kind: 'stop',
            reason: `Bước "${step.name}" không đạt sau ${step.maxRetries} lần thử lại.`,
          };
    case 'return_to_step':
      return step.returnToStepId !== null && steps.some((other) => other.id === step.returnToStepId)
        ? { kind: 'return_to_step', stepId: step.returnToStepId }
        : { kind: 'stop', reason: `Bước "${step.name}" không đạt và không có bước để quay lại.` };
    case 'stop':
      return { kind: 'stop', reason: `Bước "${step.name}" không đạt.` };
  }
}
