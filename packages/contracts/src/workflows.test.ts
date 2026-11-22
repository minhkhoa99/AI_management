import { describe, expect, it } from 'vitest';
import {
  buildWorkflowExportDocument,
  DEFAULT_WORKFLOW_RULES,
  draftWorkflowStepsRequestSchema,
  listWorkflowStepProblems,
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
    handoffDepartmentId: null,
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

  it('round-trips a handoff step through export and import', () => {
    const workflow: Workflow = {
      ...workflowWith3StepsWhereStep2ReturnsToStep0,
      steps: [
        buildStep('st_a'),
        {
          ...buildStep('st_b', 'st_a'),
          ownerRole: 'department',
          handoffDepartmentId: 'dep_review',
        },
      ],
    };

    const parsed = workflowExportDocumentSchema.parse(
      JSON.parse(JSON.stringify(buildWorkflowExportDocument(workflow))),
    );

    expect(parsed.steps[1]).toMatchObject({
      ownerRole: 'department',
      handoffDepartmentId: 'dep_review',
      returnToStepIndex: 0,
    });
    expect(parsed.steps[0]?.handoffDepartmentId).toBeNull();
  });

  it('reads an older export without handoff departments', () => {
    const document = buildWorkflowExportDocument(workflowWith3StepsWhereStep2ReturnsToStep0);
    const steps = document.steps.map(({ handoffDepartmentId: _omitted, ...step }) => step);

    const parsed = workflowExportDocumentSchema.parse({ ...document, steps });

    expect(parsed.steps.map((step) => step.handoffDepartmentId)).toEqual([null, null, null]);
  });
});

describe('listWorkflowStepProblems', () => {
  const step = (over: Record<string, unknown> = {}) =>
    ({
      ownerRole: 'dev',
      gate: 'auto',
      onFail: 'stop',
      returnToStepIndex: null,
      maxRetries: 0,
      handoffDepartmentId: null,
      ...over,
    }) as Parameters<typeof listWorkflowStepProblems>[0][number];
  const handoff = step({
    ownerRole: 'department',
    handoffDepartmentId: 'review',
    onFail: 'return_to_step',
    returnToStepIndex: 0,
  });
  const messages = (
    steps: Parameters<typeof listWorkflowStepProblems>[0],
    ownDepartmentId: string | null,
  ) => listWorkflowStepProblems(steps, ownDepartmentId).map((problem) => problem.message);

  it('accepts a handoff after a working step', () => {
    expect(messages([step(), handoff], 'dev')).toEqual([]);
  });

  it.each([
    [
      'a handoff without a department',
      [step(), { ...handoff, handoffDepartmentId: null }],
      'Chọn phòng nhận bàn giao.',
    ],
    [
      'a department on a working step',
      [step({ handoffDepartmentId: 'review' })],
      'Chỉ chọn phòng khi người phụ trách là "Phòng khác".',
    ],
    [
      'a handoff to the own department',
      [step(), { ...handoff, handoffDepartmentId: 'dev' }],
      'Không bàn giao cho chính phòng mình.',
    ],
    [
      'a handoff as the first step',
      [step({ ownerRole: 'department', handoffDepartmentId: 'review' })],
      'Bước đầu tiên không giao phòng khác được.',
    ],
    [
      'a handoff with another gate',
      [step(), { ...handoff, gate: 'qc_pass' }],
      'Bước giao phòng khác chỉ dùng điều kiện "Tự động chuyển".',
    ],
    [
      'a handoff that retries',
      [step(), { ...handoff, onFail: 'retry', returnToStepIndex: null, maxRetries: 1 }],
      'Bước giao phòng khác không dùng "Thử lại".',
    ],
  ] as const)('reports %s', (_label, steps, expected) => {
    expect(messages(steps, 'dev')).toEqual([expected]);
  });

  it('skips the own-department check without a department', () => {
    expect(messages([step(), { ...handoff, handoffDepartmentId: 'dev' }], null)).toEqual([]);
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
