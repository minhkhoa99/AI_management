import {
  WORKFLOW_MAX_STEPS,
  WORKFLOW_STEP_NAME_MAX_LENGTH,
  workflowProposalSchema,
  workflowProposalStepSchema,
  type AgentRole,
  type WorkflowProposal,
  type WorkflowProposalStep,
} from '@aiteam/contracts';
import { z } from 'zod';
import { EngineUnavailableError } from '../../../shared/errors/app-error';
import { ROLE_LABELS_FOR_PROMPTS } from './role-labels';

/** Longer answers are not read at all. */
export const WORKFLOW_PROPOSAL_TEXT_MAX_LENGTH = 200 * 1024;

const WORKFLOW_BLOCK_PATTERN = /<aiteam-workflow>([\s\S]*?)<\/aiteam-workflow>/g;

/** Steps are checked one by one below, after department steps are dropped. */
const answerSchema = z
  .object({
    steps: z.array(z.record(z.string(), z.unknown())).min(1).max(WORKFLOW_MAX_STEPS),
    changes: workflowProposalSchema.shape.changes.default([]),
  })
  .strict();

const proposedStepSchema = workflowProposalStepSchema.omit({ id: true });

type RawStep = Record<string, unknown>;

/**
 * Reads the workflow an agent proposed (untrusted text): the last `<aiteam-workflow>` block, parsed
 * strictly. Department steps are dropped (the AI does not know department ids); `fromStepIndex`
 * gives a kept step its old id, once, so tasks sitting on that step are not orphaned. Problems
 * between steps are left for the editor to show.
 */
export function interpretWorkflowProposal(input: {
  finalText: string;
  currentStepIds: readonly string[];
  staffedRoles: ReadonlySet<AgentRole>;
}): Omit<WorkflowProposal, 'basedOnTaskCount'> {
  const answer = readLastBlock(input.finalText);
  const warnings: string[] = [];
  const keptSteps = dropDepartmentSteps(answer.steps, warnings);
  if (keptSteps.length === 0) throw invalidProposal();

  const usedStepIndexes = new Set<number>();
  const steps = keptSteps.map((rawStep): WorkflowProposalStep => {
    const parsed = proposedStepSchema.safeParse(rawStep);
    if (!parsed.success) throw invalidProposal(parsed.error);
    const step = parsed.data;
    if (step.ownerRole !== 'user' && !input.staffedRoles.has(step.ownerRole)) {
      warnings.push(
        `Chưa có agent vai ${ROLE_LABELS_FOR_PROMPTS[step.ownerRole]} đang bật trong phòng (bước "${step.name}").`,
      );
    }
    const fromStepIndex = step.fromStepIndex;
    const id =
      fromStepIndex === null || usedStepIndexes.has(fromStepIndex)
        ? undefined
        : input.currentStepIds[fromStepIndex];
    if (fromStepIndex === null || id === undefined) return { ...step, fromStepIndex: null };
    usedStepIndexes.add(fromStepIndex);
    return { id, ...step };
  });
  return { steps, changes: answer.changes, warnings };
}

function readLastBlock(finalText: string): z.infer<typeof answerSchema> {
  if (finalText.length > WORKFLOW_PROPOSAL_TEXT_MAX_LENGTH) throw invalidProposal();
  const lastBlock = [...finalText.matchAll(WORKFLOW_BLOCK_PATTERN)].at(-1)?.[1];
  if (lastBlock === undefined) throw invalidProposal();
  let json: unknown;
  try {
    json = JSON.parse(lastBlock);
  } catch (error) {
    throw invalidProposal(error);
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) throw invalidProposal(parsed.error);
  return parsed.data;
}

/** Removes `department` steps; return targets pointing at them become "stop", later ones shift. */
function dropDepartmentSteps(steps: readonly RawStep[], warnings: string[]): RawStep[] {
  const droppedIndexes: number[] = [];
  steps.forEach((step, index) => {
    if (step.ownerRole !== 'department') return;
    droppedIndexes.push(index);
    warnings.push(
      `Bỏ bước "${describeRawName(step.name)}": AI không được giao bước cho phòng khác.`,
    );
  });
  return steps
    .filter((_step, index) => !droppedIndexes.includes(index))
    .map((step) => {
      const target = step.returnToStepIndex;
      if (typeof target !== 'number') return step;
      if (droppedIndexes.includes(target)) {
        return { ...step, onFail: 'stop', returnToStepIndex: null };
      }
      const shift = droppedIndexes.filter((dropped) => dropped < target).length;
      return { ...step, returnToStepIndex: target - shift };
    });
}

function describeRawName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, WORKFLOW_STEP_NAME_MAX_LENGTH) : '';
}

function invalidProposal(cause?: unknown): EngineUnavailableError {
  return new EngineUnavailableError('AI trả lời sai định dạng. Thử lại.', {
    code: 'AI_PROPOSAL_INVALID',
    cause,
  });
}
