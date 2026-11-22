import type { AgentRole } from '@aiteam/contracts';
import { describe, expect, it } from 'vitest';
import { interpretWorkflowProposal, WORKFLOW_PROPOSAL_TEXT_MAX_LENGTH } from './workflow-proposal';

const block = (answer: unknown) =>
  `Giải thích.\n<aiteam-workflow>${JSON.stringify(answer)}</aiteam-workflow>`;
const aiStep = (over: Record<string, unknown> = {}) => ({
  name: 'Code',
  ownerRole: 'dev',
  gate: 'auto',
  onFail: 'stop',
  returnToStepIndex: null,
  maxRetries: 0,
  requiredOutput: '',
  fromStepIndex: null,
  ...over,
});

function interpret(
  finalText: string,
  options: { currentStepIds?: string[]; staffedRoles?: AgentRole[] } = {},
) {
  return interpretWorkflowProposal({
    finalText,
    currentStepIds: options.currentStepIds ?? [],
    staffedRoles: new Set(options.staffedRoles ?? ['dev', 'qc']),
  });
}

describe('interpretWorkflowProposal', () => {
  it('reads only the last block', () => {
    const text = `${block({ steps: [aiStep({ name: 'Cũ' })] })}\n${block({
      steps: [aiStep({ name: 'Mới' })],
      changes: [{ title: 'Đổi tên', reason: 'Rõ hơn' }],
    })}`;
    const proposal = interpret(text);
    expect(proposal.steps.map((step) => step.name)).toEqual(['Mới']);
    expect(proposal.changes).toEqual([{ title: 'Đổi tên', reason: 'Rõ hơn' }]);
    expect(proposal.warnings).toEqual([]);
  });

  it('defaults changes to an empty list', () => {
    expect(interpret(block({ steps: [aiStep()] })).changes).toEqual([]);
  });

  it.each([
    'không có khối',
    '<aiteam-workflow>{</aiteam-workflow>',
    block({ steps: [aiStep({ extra: 1 })] }),
    block({ steps: [aiStep()], extra: 1 }),
    block({ steps: Array.from({ length: 21 }, () => aiStep()) }),
    block({ steps: [aiStep(), aiStep({ gate: 'magic' })] }),
    block({ steps: [aiStep({ id: 'step-1' })] }),
    'x'.repeat(WORKFLOW_PROPOSAL_TEXT_MAX_LENGTH + 1) + block({ steps: [aiStep()] }),
  ])('rejects malformed answer %#', (text) => {
    expect(() => interpret(text)).toThrow(
      expect.objectContaining({ code: 'AI_PROPOSAL_INVALID', retryable: true }),
    );
  });

  it('maps fromStepIndex to existing ids, each id once', () => {
    const proposal = interpret(
      block({
        steps: [1, 1, 0, 5].map((fromStepIndex) => aiStep({ fromStepIndex })),
      }),
      { currentStepIds: ['s1', 's2'] },
    );
    expect(proposal.steps.map((step) => step.id)).toEqual(['s2', undefined, 's1', undefined]);
    expect(proposal.steps.map((step) => step.fromStepIndex)).toEqual([1, null, 0, null]);
    expect('id' in proposal.steps[1]!).toBe(false);
  });

  it('drops department steps and fixes return targets, warns about unstaffed roles', () => {
    const proposal = interpret(
      block({
        steps: [
          aiStep({ name: 'A' }),
          aiStep({ name: 'Review', ownerRole: 'department' }),
          aiStep({ name: 'B', ownerRole: 'qc', onFail: 'return_to_step', returnToStepIndex: 0 }),
          aiStep({ name: 'C', onFail: 'return_to_step', returnToStepIndex: 1 }),
          aiStep({ name: 'D', onFail: 'return_to_step', returnToStepIndex: 2 }),
        ],
      }),
      { staffedRoles: ['dev'] },
    );
    expect(proposal.steps.map((step) => step.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(proposal.steps[1]).toMatchObject({ onFail: 'return_to_step', returnToStepIndex: 0 });
    expect(proposal.steps[2]).toMatchObject({ onFail: 'stop', returnToStepIndex: null });
    expect(proposal.steps[3]).toMatchObject({ onFail: 'return_to_step', returnToStepIndex: 1 });
    expect(proposal.warnings).toEqual([
      'Bỏ bước "Review": AI không được giao bước cho phòng khác.',
      'Chưa có agent vai QC đang bật trong phòng (bước "B").',
    ]);
  });

  it('rejects an answer whose steps were all department steps', () => {
    expect(() => interpret(block({ steps: [aiStep({ ownerRole: 'department' })] }))).toThrow(
      expect.objectContaining({ code: 'AI_PROPOSAL_INVALID' }),
    );
  });

  it('rejects an AI step that carries handoffDepartmentId', () => {
    expect(() => interpret(block({ steps: [aiStep({ handoffDepartmentId: null })] }))).toThrow(
      expect.objectContaining({ code: 'AI_PROPOSAL_INVALID' }),
    );
  });

  it('gives every proposed step no handoff department', () => {
    expect(interpret(block({ steps: [aiStep()] })).steps[0]?.handoffDepartmentId).toBeNull();
  });

  it('keeps cross-step problems for the editor', () => {
    const proposal = interpret(block({ steps: [aiStep({ ownerRole: 'user', gate: 'auto' })] }));
    expect(proposal.steps[0]).toMatchObject({ ownerRole: 'user', gate: 'auto' });
    expect(proposal.warnings).toEqual([]);
  });
});
