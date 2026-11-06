import {
  STEP_RETRY_LIMITS,
  type StepFailureAction,
  type StepOwner,
  type Workflow,
  type WorkflowStepDraft,
} from '@aiteam/contracts';

/** A step being edited; `key` only identifies it in React lists and is never sent. */
export type EditableStep = WorkflowStepDraft & { key: string };

let nextStepKey = 0;
const createStepKey = () => `step-key-${(nextStepKey += 1)}`;

export function editableStepsOf(workflow: Workflow): EditableStep[] {
  const indexById = new Map(workflow.steps.map((step, index) => [step.id, index]));
  return workflow.steps.map((step) => ({
    key: step.id,
    id: step.id,
    name: step.name,
    ownerRole: step.ownerRole,
    gate: step.gate,
    onFail: step.onFail,
    returnToStepIndex:
      step.returnToStepId === null ? null : (indexById.get(step.returnToStepId) ?? null),
    maxRetries: step.maxRetries,
    requiredOutput: step.requiredOutput,
  }));
}

/** Template steps have no ids: saving them replaces the whole chain. */
export function editableStepsFromBlueprints(
  blueprints: readonly Omit<WorkflowStepDraft, 'id'>[],
): EditableStep[] {
  return blueprints.map((blueprint) => ({ ...blueprint, key: createStepKey() }));
}

export function toStepDrafts(steps: readonly EditableStep[]): WorkflowStepDraft[] {
  return steps.map(({ key: _key, ...draft }) => draft);
}

export function appendNewStep(steps: readonly EditableStep[]): EditableStep[] {
  return [
    ...steps,
    {
      key: createStepKey(),
      name: `Bước ${steps.length + 1}`,
      ownerRole: 'dev',
      gate: 'auto',
      onFail: 'stop',
      returnToStepIndex: null,
      maxRetries: 0,
      requiredOutput: '',
    },
  ];
}

/** Removes a step; steps that returned to it now stop instead, later targets shift down. */
export function removeStep(steps: readonly EditableStep[], removedIndex: number): EditableStep[] {
  return steps
    .filter((_step, index) => index !== removedIndex)
    .map((step) => {
      if (step.returnToStepIndex === removedIndex) {
        return { ...step, onFail: 'stop', returnToStepIndex: null };
      }
      if (step.returnToStepIndex !== null && step.returnToStepIndex > removedIndex) {
        return { ...step, returnToStepIndex: step.returnToStepIndex - 1 };
      }
      return step;
    });
}

/** Swaps a step with its neighbour; return targets follow the steps they point to. */
export function swapSteps(
  steps: readonly EditableStep[],
  firstIndex: number,
  secondIndex: number,
): EditableStep[] {
  const remapIndex = (index: number | null) =>
    index === firstIndex ? secondIndex : index === secondIndex ? firstIndex : index;
  const reordered = steps.map((step) => ({
    ...step,
    returnToStepIndex: remapIndex(step.returnToStepIndex),
  }));
  const first = reordered[firstIndex];
  const second = reordered[secondIndex];
  if (first === undefined || second === undefined) {
    return [...steps];
  }
  reordered[firstIndex] = second;
  reordered[secondIndex] = first;
  return reordered;
}

/** Keeps dependent fields consistent when the owner changes (the user only approves). */
export function changeStepOwner(step: EditableStep, ownerRole: StepOwner): EditableStep {
  return ownerRole === 'user'
    ? { ...step, ownerRole, gate: 'user_approval' }
    : { ...step, ownerRole };
}

export function changeFailureAction(
  step: EditableStep,
  stepIndex: number,
  onFail: StepFailureAction,
): EditableStep {
  return {
    ...step,
    onFail,
    returnToStepIndex: onFail === 'return_to_step' && stepIndex > 0 ? stepIndex - 1 : null,
    maxRetries:
      onFail === 'retry' ? Math.max(step.maxRetries, STEP_RETRY_LIMITS.min) : step.maxRetries,
  };
}
