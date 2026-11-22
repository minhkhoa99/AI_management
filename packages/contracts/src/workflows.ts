import { z } from 'zod';
import {
  STEP_RETRY_LIMITS,
  stepFailureActionSchema,
  stepGateSchema,
  stepOwnerSchema,
  type StepFailureAction,
  type StepGate,
  type StepOwner,
} from './enumerations';
import { entityIdSchema } from './organization';

// Request and response contracts for department workflows (phase 3).

export const WORKFLOW_NAME_MAX_LENGTH = 60;
export const WORKFLOW_DESCRIPTION_MAX_LENGTH = 200;
export const WORKFLOW_STEP_NAME_MAX_LENGTH = 80;
export const WORKFLOW_STEP_OUTPUT_MAX_LENGTH = 300;
export const WORKFLOW_MAX_STEPS = 20;
export const WORKFLOW_GOAL_MAX_LENGTH = 4000;

const workflowNameSchema = z
  .string()
  .trim()
  .min(1, 'Nhập tên cho quy trình')
  .max(WORKFLOW_NAME_MAX_LENGTH);
const workflowDescriptionSchema = z.string().trim().max(WORKFLOW_DESCRIPTION_MAX_LENGTH);

// ---- Rules ---------------------------------------------------------------------------------

/**
 * Department-wide rules of a workflow. "Log every step" from the mockup is not a rule: every
 * step is always logged. The budget rule waits for budgets (postponed in phase 5).
 */
export const workflowRulesSchema = z
  .object({
    /** Manual stage moves cannot jump over steps. */
    noSkippingSteps: z.boolean(),
    /** Agents must stop and ask the user before deleting data, spending money, publishing or deploying. */
    sensitiveActionsNeedApproval: z.boolean(),
    /** Agents may split a step into smaller sub-steps, as long as they report them. */
    allowAgentSubsteps: z.boolean(),
  })
  .strict();
export type WorkflowRules = z.infer<typeof workflowRulesSchema>;

export const DEFAULT_WORKFLOW_RULES: WorkflowRules = {
  noSkippingSteps: true,
  sensitiveActionsNeedApproval: true,
  allowAgentSubsteps: false,
};

// ---- Steps ---------------------------------------------------------------------------------

export const workflowStepSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  ownerRole: stepOwnerSchema,
  gate: stepGateSchema,
  onFail: stepFailureActionSchema,
  /** Target of on_fail = return_to_step; always an earlier step. */
  returnToStepId: entityIdSchema.nullable(),
  maxRetries: z.number().int().min(0).max(STEP_RETRY_LIMITS.max),
  requiredOutput: z.string(),
  /** Department receiving the task when ownerRole = department; null otherwise. */
  handoffDepartmentId: entityIdSchema.nullable(),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

/**
 * One step as edited in the UI and sent when saving. Existing steps keep their `id`; the return
 * target is the index of an earlier step in the same list.
 */
export const workflowStepDraftSchema = z
  .object({
    id: entityIdSchema.optional(),
    name: z.string().trim().min(1, 'Nhập tên bước').max(WORKFLOW_STEP_NAME_MAX_LENGTH),
    ownerRole: stepOwnerSchema,
    gate: stepGateSchema,
    onFail: stepFailureActionSchema,
    returnToStepIndex: z.number().int().min(0).nullable(),
    maxRetries: z.number().int().min(0).max(STEP_RETRY_LIMITS.max),
    requiredOutput: z.string().trim().max(WORKFLOW_STEP_OUTPUT_MAX_LENGTH),
    handoffDepartmentId: entityIdSchema.nullable().default(null),
  })
  .strict();
export type WorkflowStepDraft = z.infer<typeof workflowStepDraftSchema>;

export interface WorkflowStepProblem {
  stepIndex: number;
  message: string;
}

interface StepRuleInput {
  id?: string | undefined;
  ownerRole: StepOwner;
  gate: StepGate;
  onFail: StepFailureAction;
  returnToStepIndex: number | null;
  maxRetries: number;
  handoffDepartmentId: string | null;
}

/**
 * Rules that span fields or steps. Shared by the editor (inline hints) and the server (which
 * rejects the save). Returns every problem, in step order. `ownDepartmentId` is the department
 * of the workflow (null skips the "not to itself" check).
 */
export function listWorkflowStepProblems(
  steps: readonly StepRuleInput[],
  ownDepartmentId: string | null,
): WorkflowStepProblem[] {
  const problems: WorkflowStepProblem[] = [];
  const seenIds = new Set<string>();
  steps.forEach((step, stepIndex) => {
    const report = (message: string) => problems.push({ stepIndex, message });
    if (step.id !== undefined) {
      if (seenIds.has(step.id)) report('Bước bị trùng.');
      seenIds.add(step.id);
    }
    if (step.ownerRole === 'user' && step.gate !== 'user_approval') {
      report('Bước do bạn phụ trách chỉ dùng điều kiện "Bạn duyệt".');
    }
    reportHandoffProblems(step, stepIndex, ownDepartmentId, report);
    if (step.onFail === 'return_to_step') {
      if (step.returnToStepIndex === null) {
        report('Chọn bước để quay lại.');
      } else if (step.returnToStepIndex >= stepIndex) {
        report('Chỉ quay lại được một bước đứng trước.');
      }
    } else if (step.returnToStepIndex !== null) {
      report('Chỉ chọn bước quay lại khi "Khi không đạt" là quay lại.');
    }
    if (
      step.onFail === 'retry' &&
      (step.maxRetries < STEP_RETRY_LIMITS.min || step.maxRetries > STEP_RETRY_LIMITS.max)
    ) {
      report(`Số lần thử lại từ ${STEP_RETRY_LIMITS.min} đến ${STEP_RETRY_LIMITS.max}.`);
    }
  });
  return problems;
}

function reportHandoffProblems(
  step: StepRuleInput,
  stepIndex: number,
  ownDepartmentId: string | null,
  report: (message: string) => void,
): void {
  const isHandoff = step.ownerRole === 'department';
  if (isHandoff && step.handoffDepartmentId === null) report('Chọn phòng nhận bàn giao.');
  if (!isHandoff && step.handoffDepartmentId !== null) {
    report('Chỉ chọn phòng khi người phụ trách là "Phòng khác".');
  }
  if (ownDepartmentId !== null && step.handoffDepartmentId === ownDepartmentId) {
    report('Không bàn giao cho chính phòng mình.');
  }
  if (!isHandoff) return;
  if (stepIndex === 0) report('Bước đầu tiên không giao phòng khác được.');
  if (step.gate !== 'auto') report('Bước giao phòng khác chỉ dùng điều kiện "Tự động chuyển".');
  if (step.onFail === 'retry') report('Bước giao phòng khác không dùng "Thử lại".');
}

// ---- Workflows -----------------------------------------------------------------------------

export const workflowSchema = z.object({
  id: entityIdSchema,
  departmentId: entityIdSchema,
  name: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  /** false: agents choose their own order, the platform only records what happens. */
  enforce: z.boolean(),
  rules: workflowRulesSchema,
  steps: z.array(workflowStepSchema),
  taskCount: z.number().int().nonnegative(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export const workflowListSchema = z.array(workflowSchema);

export const WORKFLOW_TEMPLATE_IDS = ['software', 'content', 'hotfix', 'ticket'] as const;
export const workflowTemplateIdSchema = z.enum(WORKFLOW_TEMPLATE_IDS);
export type WorkflowTemplateId = z.infer<typeof workflowTemplateIdSchema>;

export const workflowTemplateSchema = z.object({
  id: workflowTemplateIdSchema,
  label: z.string(),
  steps: z.array(workflowStepDraftSchema),
});
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;
export const workflowTemplateListSchema = z.array(workflowTemplateSchema);

// ---- JSON import/export --------------------------------------------------------------------

/** A workflow saved to a file: no ids, return targets as step indexes. */
export const workflowExportDocumentSchema = z
  .object({
    format: z.literal('aiteam-workflow'),
    version: z.literal(1),
    name: workflowNameSchema,
    description: workflowDescriptionSchema,
    enforce: z.boolean(),
    rules: workflowRulesSchema,
    steps: z
      .array(workflowStepDraftSchema.omit({ id: true }))
      .min(1)
      .max(WORKFLOW_MAX_STEPS),
  })
  .strict();
export type WorkflowExportDocument = z.infer<typeof workflowExportDocumentSchema>;

export function buildWorkflowExportDocument(workflow: Workflow): WorkflowExportDocument {
  const indexById = new Map(workflow.steps.map((step, index) => [step.id, index]));
  return {
    format: 'aiteam-workflow',
    version: 1,
    name: workflow.name,
    description: workflow.description,
    enforce: workflow.enforce,
    rules: { ...workflow.rules },
    steps: workflow.steps.map((step) => ({
      name: step.name,
      ownerRole: step.ownerRole,
      gate: step.gate,
      onFail: step.onFail,
      returnToStepIndex:
        step.returnToStepId === null ? null : (indexById.get(step.returnToStepId) ?? null),
      maxRetries: step.maxRetries,
      requiredOutput: step.requiredOutput,
      handoffDepartmentId: step.handoffDepartmentId,
    })),
  };
}

export const workflowSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blank') }).strict(),
  z.object({ kind: z.literal('template'), templateId: workflowTemplateIdSchema }).strict(),
  z.object({ kind: z.literal('copy'), workflowId: entityIdSchema }).strict(),
  z.object({ kind: z.literal('import'), document: workflowExportDocumentSchema }).strict(),
]);
export type WorkflowSource = z.infer<typeof workflowSourceSchema>;

export const createWorkflowRequestSchema = z
  .object({
    name: workflowNameSchema,
    description: workflowDescriptionSchema.default(''),
    source: workflowSourceSchema,
  })
  .strict();
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;

export const updateWorkflowRequestSchema = z
  .object({
    name: workflowNameSchema.optional(),
    description: workflowDescriptionSchema.optional(),
  })
  .strict()
  .refine((request) => request.name !== undefined || request.description !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;

export const replaceWorkflowStepsRequestSchema = z
  .object({
    steps: z
      .array(workflowStepDraftSchema)
      .min(1, 'Quy trình cần ít nhất một bước')
      .max(WORKFLOW_MAX_STEPS),
  })
  .strict();
export type ReplaceWorkflowStepsRequest = z.infer<typeof replaceWorkflowStepsRequestSchema>;

export const updateWorkflowRulesRequestSchema = z
  .object({
    enforce: z.boolean().optional(),
    rules: workflowRulesSchema.partial().strict().optional(),
  })
  .strict()
  .refine((request) => request.enforce !== undefined || request.rules !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateWorkflowRulesRequest = z.infer<typeof updateWorkflowRulesRequestSchema>;

export const setDefaultWorkflowRequestSchema = z.object({ workflowId: entityIdSchema }).strict();
export type SetDefaultWorkflowRequest = z.infer<typeof setDefaultWorkflowRequestSchema>;

// ---- AI proposals --------------------------------------------------------------------------

export const draftWorkflowStepsRequestSchema = z
  .object({
    goal: z.string().trim().min(1, 'Nhập mục tiêu cho quy trình').max(WORKFLOW_GOAL_MAX_LENGTH),
    agentId: entityIdSchema.optional(),
  })
  .strict();
export type DraftWorkflowStepsRequest = z.infer<typeof draftWorkflowStepsRequestSchema>;

export const proposeWorkflowOptimizationRequestSchema = z
  .object({ agentId: entityIdSchema.optional() })
  .strict();
export type ProposeWorkflowOptimizationRequest = z.infer<
  typeof proposeWorkflowOptimizationRequestSchema
>;

/** A proposed step; `fromStepIndex` points at the current step it keeps (null = new step). */
export const workflowProposalStepSchema = workflowStepDraftSchema.extend({
  fromStepIndex: z.number().int().min(0).nullable(),
});
export type WorkflowProposalStep = z.infer<typeof workflowProposalStepSchema>;

/** What the AI suggests; never saved by the server, the user saves it through the editor. */
export const workflowProposalSchema = z.object({
  steps: z.array(workflowProposalStepSchema).min(1).max(WORKFLOW_MAX_STEPS),
  changes: z
    .array(
      z
        .object({
          title: z.string().trim().min(1).max(120),
          reason: z.string().trim().max(500),
        })
        .strict(),
    )
    .max(20),
  warnings: z.array(z.string()),
  basedOnTaskCount: z.number().int().nonnegative(),
});
export type WorkflowProposal = z.infer<typeof workflowProposalSchema>;
