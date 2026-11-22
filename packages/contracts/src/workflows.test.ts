import { describe, expect, it } from 'vitest';
import {
  buildWorkflowExportDocument,
  DEFAULT_WORKFLOW_RULES,
  draftWorkflowStepsRequestSchema,
  type Workflow,
  type WorkflowStep,
  workflowExportDocumentSchema,
  workflowProposalSchema,
  workflowSourceSchema,
} from './workflows';

function buildStep(id: string, returnToStepId: string | null = null): WorkflowStep {
  return {
    id,
    name: `Bước ${id}`,
    ownerRole: 'dev',
    gate: 'auto',
    onFail: returnToStepId === null ? 'stop' : 'return_to_step',
    returnToStepId,
    maxRetries: 0,
    requiredOutput: 'Báo cáo',
  };
}

const workflowWith3StepsWhereStep2ReturnsToStep0: Workflow = {
  id: 'wf_1',
  departmentId: 'dep_1',
  name: 'Phát triển',
  description: 'Mô tả',
  isDefault: true,
  enforce: false,
  rules: { ...DEFAULT_WORKFLOW_RULES, allowAgentSubsteps: true },
  steps: [buildStep('st_a'), buildStep('st_b'), buildStep('st_c', 'st_a')],
  taskCount: 3,
};

describe('buildWorkflowExportDocument', () => {
  it('exports a workflow without ids, return targets as indexes', () => {
    const document = buildWorkflowExportDocument(workflowWith3StepsWhereStep2ReturnsToStep0);

    expect(document).toMatchObject({
      format: 'aiteam-workflow',
      version: 1,
      name: 'Phát triển',
      description: 'Mô tả',
      enforce: false,
      rules: { allowAgentSubsteps: true },
    });
    expect(document.steps[2]).not.toHaveProperty('id');
    expect(document.steps[2]?.returnToStepIndex).toBe(0);
    expect(document.steps[0]?.returnToStepIndex).toBeNull();
    expect(workflowExportDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('rejects another format, version 2 and unknown fields', () => {
    const document = buildWorkflowExportDocument(workflowWith3StepsWhereStep2ReturnsToStep0);
    const firstStep = document.steps[0]!;

    expect(workflowExportDocumentSchema.safeParse({ ...document, format: 'other' }).success).toBe(
      false,
    );
    expect(workflowExportDocumentSchema.safeParse({ ...document, version: 2 }).success).toBe(false);
    expect(workflowExportDocumentSchema.safeParse({ ...document, extra: true }).success).toBe(
      false,
    );
    expect(
      workflowExportDocumentSchema.safeParse({
        ...document,
        steps: [{ ...firstStep, id: 'st_a' }],
      }).success,
    ).toBe(false);
    expect(
      workflowSourceSchema.safeParse({ kind: 'import', document, workflowId: 'wf_1' }).success,
    ).toBe(false);
    expect(workflowSourceSchema.safeParse({ kind: 'import', document }).success).toBe(true);
  });
});

describe('AI workflow proposals', () => {
  it('limits the AI goal to 4000 characters and proposals to 20 steps', () => {
    const step = {
      name: 'Bước',
      ownerRole: 'dev',
      gate: 'auto',
      onFail: 'stop',
      returnToStepIndex: null,
      maxRetries: 0,
      requiredOutput: '',
      fromStepIndex: null,
    };
    const proposal = (stepCount: number) => ({
      steps: Array.from({ length: stepCount }, () => step),
      changes: [{ title: 'Gộp bước', reason: 'Thừa' }],
      warnings: [],
      basedOnTaskCount: 5,
    });

    expect(draftWorkflowStepsRequestSchema.safeParse({ goal: 'a'.repeat(4000) }).success).toBe(
      true,
    );
    expect(draftWorkflowStepsRequestSchema.safeParse({ goal: 'a'.repeat(4001) }).success).toBe(
      false,
    );
    expect(draftWorkflowStepsRequestSchema.safeParse({ goal: '   ' }).success).toBe(false);
    expect(workflowProposalSchema.safeParse(proposal(20)).success).toBe(true);
    expect(workflowProposalSchema.safeParse(proposal(21)).success).toBe(false);
    expect(workflowProposalSchema.safeParse(proposal(0)).success).toBe(false);
  });
});
