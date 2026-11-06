import {
  DEFAULT_WORKFLOW_RULES,
  listWorkflowStepProblems,
  WORKFLOW_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_STEP_NAME_MAX_LENGTH,
  type StepFailureAction,
  type StepGate,
  type StepOwner,
  type WorkflowRules,
  type WorkflowStepDraft,
} from '@aiteam/contracts';
import { DisplayName } from '../../../../shared/domain/display-name';
import { ValidationError } from '../../../../shared/errors/app-error';
import type { IdGenerator } from '../../../../shared/identifiers/id-generator';

export interface WorkflowStepState {
  id: string;
  name: string;
  ownerRole: StepOwner;
  gate: StepGate;
  onFail: StepFailureAction;
  returnToStepId: string | null;
  maxRetries: number;
  requiredOutput: string;
}

export interface WorkflowState {
  id: string;
  departmentId: string;
  name: string;
  description: string;
  isDefault: boolean;
  enforce: boolean;
  rules: WorkflowRules;
  steps: WorkflowStepState[];
}

/** Steps without ids, as in templates or when copying another workflow. */
export type WorkflowStepBlueprint = Omit<WorkflowStepDraft, 'id'>;

/** A department's ordered chain of steps, with the gate and failure behaviour of each step. */
export class Workflow {
  private constructor(private state: WorkflowState) {}

  static createNew(input: {
    id: string;
    departmentId: string;
    name: string;
    description: string;
    isDefault: boolean;
    steps: readonly WorkflowStepBlueprint[];
    idGenerator: IdGenerator;
  }): Workflow {
    return new Workflow({
      id: input.id,
      departmentId: input.departmentId,
      name: parseWorkflowName(input.name).text,
      description: parseWorkflowDescription(input.description),
      isDefault: input.isDefault,
      enforce: true,
      rules: { ...DEFAULT_WORKFLOW_RULES },
      steps: buildWorkflowSteps(input.steps, new Set(), input.idGenerator),
    });
  }

  /** Rebuilds a workflow loaded from storage (already validated when it was saved). */
  static restore(state: WorkflowState): Workflow {
    return new Workflow({ ...state, rules: { ...state.rules }, steps: [...state.steps] });
  }

  get id(): string {
    return this.state.id;
  }

  get departmentId(): string {
    return this.state.departmentId;
  }

  get name(): string {
    return this.state.name;
  }

  get isDefault(): boolean {
    return this.state.isDefault;
  }

  get steps(): readonly WorkflowStepState[] {
    return this.state.steps;
  }

  rename(newName: string): void {
    this.state.name = parseWorkflowName(newName).text;
  }

  describe(newDescription: string): void {
    this.state.description = parseWorkflowDescription(newDescription);
  }

  hasSameNameAs(otherName: string): boolean {
    return parseWorkflowName(this.state.name).isSameNameAs(parseWorkflowName(otherName));
  }

  setDefault(isDefault: boolean): void {
    this.state.isDefault = isDefault;
  }

  changeRules(changes: { enforce?: boolean; rules?: Partial<WorkflowRules> }): void {
    if (changes.enforce !== undefined) {
      this.state.enforce = changes.enforce;
    }
    if (changes.rules !== undefined) {
      this.state.rules = { ...this.state.rules, ...changes.rules };
    }
  }

  /**
   * Replaces the whole chain. Steps that keep their id keep their identity (tasks on them stay
   * there); returns the ids of steps that were removed.
   */
  replaceSteps(drafts: readonly WorkflowStepDraft[], idGenerator: IdGenerator): string[] {
    const currentIds = new Set(this.state.steps.map((step) => step.id));
    const newSteps = buildWorkflowSteps(drafts, currentIds, idGenerator);
    const keptIds = new Set(newSteps.map((step) => step.id));
    this.state.steps = newSteps;
    return [...currentIds].filter((stepId) => !keptIds.has(stepId));
  }

  /** The steps of this workflow without ids, so another workflow can start from them. */
  copyStepBlueprints(): WorkflowStepBlueprint[] {
    const indexById = new Map(this.state.steps.map((step, index) => [step.id, index]));
    return this.state.steps.map((step) => ({
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

  toState(): WorkflowState {
    return { ...this.state, rules: { ...this.state.rules }, steps: [...this.state.steps] };
  }
}

export function parseWorkflowName(rawName: string): DisplayName {
  return DisplayName.parse(rawName, WORKFLOW_NAME_MAX_LENGTH, 'WORKFLOW_NAME_INVALID');
}

function parseWorkflowDescription(rawDescription: string): string {
  const description = rawDescription.normalize('NFC').trim();
  if (description.length > WORKFLOW_DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(`Mô tả tối đa ${WORKFLOW_DESCRIPTION_MAX_LENGTH} ký tự.`, {
      code: 'WORKFLOW_DESCRIPTION_INVALID',
    });
  }
  return description;
}

/**
 * Validates a chain (shared rules from contracts) and turns it into steps with ids. A draft id
 * must be one of `existingIds`: clients cannot invent ids.
 */
function buildWorkflowSteps(
  drafts: readonly WorkflowStepDraft[],
  existingIds: ReadonlySet<string>,
  idGenerator: IdGenerator,
): WorkflowStepState[] {
  if (drafts.length === 0 || drafts.length > WORKFLOW_MAX_STEPS) {
    throw new ValidationError(`Quy trình cần từ 1 đến ${WORKFLOW_MAX_STEPS} bước.`, {
      code: 'WORKFLOW_STEPS_INVALID',
    });
  }
  const problems = listWorkflowStepProblems(drafts);
  if (problems.length > 0) {
    throw new ValidationError(
      `Bước ${(problems[0]?.stepIndex ?? 0) + 1}: ${problems[0]?.message ?? ''}`,
      { code: 'WORKFLOW_STEPS_INVALID', details: problems },
    );
  }
  const unknownDraft = drafts.find((draft) => draft.id !== undefined && !existingIds.has(draft.id));
  if (unknownDraft !== undefined) {
    throw new ValidationError('Bước không thuộc quy trình này.', {
      code: 'WORKFLOW_STEP_UNKNOWN',
    });
  }

  const stepIds = drafts.map((draft) => draft.id ?? idGenerator.generateId());
  return drafts.map((draft, index) => ({
    id: stepIds[index] ?? idGenerator.generateId(),
    name: DisplayName.parse(draft.name, WORKFLOW_STEP_NAME_MAX_LENGTH, 'WORKFLOW_STEP_NAME_INVALID')
      .text,
    ownerRole: draft.ownerRole,
    gate: draft.gate,
    onFail: draft.onFail,
    returnToStepId:
      draft.onFail === 'return_to_step' && draft.returnToStepIndex !== null
        ? (stepIds[draft.returnToStepIndex] ?? null)
        : null,
    // Retries only mean something for on_fail = retry (SQL CHECK keeps the others at 0).
    maxRetries: draft.onFail === 'retry' ? draft.maxRetries : 0,
    requiredOutput: draft.requiredOutput.normalize('NFC').trim(),
  }));
}
