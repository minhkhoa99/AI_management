import type { WorkflowStepDraft } from '@aiteam/contracts';
import { describe, expect, it } from 'vitest';
import { BLANK_WORKFLOW_STEPS, WORKFLOW_TEMPLATES } from '../workflow-templates';
import { Workflow } from './workflow';

function createIdGenerator() {
  let nextId = 0;
  return { generateId: () => `step-${(nextId += 1)}` };
}

function draft(overrides: Partial<WorkflowStepDraft> = {}): WorkflowStepDraft {
  return {
    name: 'Bước',
    ownerRole: 'dev',
    gate: 'auto',
    onFail: 'stop',
    returnToStepIndex: null,
    maxRetries: 0,
    requiredOutput: '',
    ...overrides,
  };
}

function createWorkflow(steps: WorkflowStepDraft[] = [draft({ name: 'A' }), draft({ name: 'B' })]) {
  return Workflow.createNew({
    id: 'flow',
    departmentId: 'dev',
    name: 'Phát triển',
    description: '',
    isDefault: true,
    steps,
    idGenerator: createIdGenerator(),
  });
}

describe('Workflow steps', () => {
  it('every built-in template and the blank workflow pass the step rules', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(() => createWorkflow([...template.steps]), template.id).not.toThrow();
    }
    expect(() => createWorkflow([...BLANK_WORKFLOW_STEPS])).not.toThrow();
  });

  it('turns a return index into the id of that earlier step', () => {
    const workflow = createWorkflow([
      draft({ name: 'Phát triển' }),
      draft({
        name: 'Kiểm thử',
        ownerRole: 'qc',
        gate: 'qc_pass',
        onFail: 'return_to_step',
        returnToStepIndex: 0,
      }),
    ]);

    const [develop, test] = workflow.steps;
    expect(test?.returnToStepId).toBe(develop?.id);
  });

  it.each([
    [
      'a return to a later step',
      [draft(), draft({ onFail: 'return_to_step', returnToStepIndex: 1 })],
    ],
    ['a return without target', [draft({ onFail: 'return_to_step', returnToStepIndex: null })]],
    ['retry with 0 retries', [draft({ onFail: 'retry', maxRetries: 0 })]],
    ['a user step that is not an approval', [draft({ ownerRole: 'user', gate: 'auto' })]],
    [
      'a target with another failure action',
      [draft(), draft({ onFail: 'stop', returnToStepIndex: 0 })],
    ],
  ])('rejects %s', (_label, steps) => {
    expect(() => createWorkflow(steps)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_STEPS_INVALID' }),
    );
  });

  it('keeps the identity of kept steps, reports removed ones and refuses unknown ids', () => {
    const workflow = createWorkflow([
      draft({ name: 'A' }),
      draft({ name: 'B' }),
      draft({ name: 'C' }),
    ]);
    const [first, , third] = workflow.steps;
    const idGenerator = createIdGenerator();

    const removed = workflow.replaceSteps(
      [
        draft({ id: third?.id, name: 'C' }),
        draft({ name: 'Mới' }),
        draft({ id: first?.id, name: 'A' }),
      ],
      idGenerator,
    );

    expect(workflow.steps.map((step) => step.name)).toEqual(['C', 'Mới', 'A']);
    expect(workflow.steps[0]?.id).toBe(third?.id);
    expect(removed).toHaveLength(1);
    expect(() => workflow.replaceSteps([draft({ id: 'invented' })], idGenerator)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_STEP_UNKNOWN' }),
    );
  });

  it('stores no retries unless the step retries', () => {
    const workflow = createWorkflow([draft({ onFail: 'stop', maxRetries: 3 })]);

    expect(workflow.steps[0]?.maxRetries).toBe(0);
  });

  it('copies steps as blueprints with the same return targets', () => {
    const workflow = createWorkflow([...WORKFLOW_TEMPLATES[0]!.steps]);

    expect(workflow.copyStepBlueprints()).toEqual(WORKFLOW_TEMPLATES[0]!.steps);
  });
});
