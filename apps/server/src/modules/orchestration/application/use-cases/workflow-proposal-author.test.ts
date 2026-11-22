import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../shared/errors/app-error';
import { createAppLogger } from '../../../../shared/logging/app-logger';
import type { StaffAgent } from '../ports/task-execution.ports';
import { WorkflowProposalAuthor } from './workflow-proposal-author';

const ANSWER = `<aiteam-workflow>${JSON.stringify({
  steps: [
    {
      name: 'Làm',
      ownerRole: 'dev',
      gate: 'auto',
      onFail: 'stop',
      returnToStepIndex: null,
      maxRetries: 0,
      requiredOutput: '',
      fromStepIndex: null,
    },
  ],
  changes: [],
})}</aiteam-workflow>`;

function staffMember(agentId: string, overrides: Partial<StaffAgent> = {}): StaffAgent {
  return {
    agentId,
    name: agentId,
    role: 'dev',
    available: true,
    positionId: `position-${agentId}`,
    reportsToPositionId: 'position-head',
    ...overrides,
  };
}

function createAuthor(staff: StaffAgent[]) {
  const staffDirectory = {
    listDepartmentStaff: vi.fn(() => staff),
    readEngineSnapshot: vi.fn((agentId: string) => ({
      agentId,
      name: agentId,
      role: 'dev' as const,
      provider: 'claude_code' as const,
      connectionId: null,
      model: 'sonnet',
      accessLevel: 'edit_workspace' as const,
      networkAccess: true,
    })),
    countActiveTasksByAgent: vi.fn(),
  };
  const runner = { askAgentOnce: vi.fn(() => Promise.resolve(ANSWER)) };
  const author = new WorkflowProposalAuthor(
    staffDirectory,
    runner,
    createAppLogger({ level: 'silent' }),
  );
  return { author, runner };
}

const DRAFT = { kind: 'draft' as const, goal: 'Viết blog' };

describe('WorkflowProposalAuthor', () => {
  it('asks the department head by default, read-only and offline, keyed by department', async () => {
    const { author, runner } = createAuthor([
      staffMember('dev-1'),
      staffMember('head', {
        role: 'manager',
        positionId: 'position-head',
        reportsToPositionId: null,
      }),
    ]);

    const proposal = await author.writeWorkflowProposal({
      departmentId: 'dept-1',
      departmentName: 'Dev',
      agentId: undefined,
      mode: DRAFT,
    });

    expect(runner.askAgentOnce).toHaveBeenCalledWith({
      snapshot: {
        agentId: 'head',
        provider: 'claude_code',
        connectionId: null,
        model: 'sonnet',
        accessLevel: 'read_only',
        networkAccess: false,
      },
      prompt: expect.stringContaining('Viết blog') as string,
      runKey: 'workflow-ai:dept-1',
    });
    expect(proposal.steps).toHaveLength(1);
    expect(proposal.warnings).toEqual([]);
  });

  it('falls back to the first available agent when the head is switched off', async () => {
    const { author, runner } = createAuthor([
      staffMember('head', {
        role: 'manager',
        available: false,
        positionId: 'position-head',
        reportsToPositionId: null,
      }),
      staffMember('off', { available: false }),
      staffMember('dev-1'),
    ]);

    await author.writeWorkflowProposal({
      departmentId: 'dept-1',
      departmentName: 'Dev',
      agentId: undefined,
      mode: DRAFT,
    });

    expect(runner.askAgentOnce).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ agentId: 'dev-1' }) }),
    );
  });

  it('refuses an agent of another department without calling the engine', async () => {
    const { author, runner } = createAuthor([staffMember('dev-1')]);

    const attempt = author.writeWorkflowProposal({
      departmentId: 'dept-1',
      departmentName: 'Dev',
      agentId: 'stranger',
      mode: DRAFT,
    });

    await expect(attempt).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_AI_AGENT_INVALID',
    );
    expect(runner.askAgentOnce).not.toHaveBeenCalled();
  });

  it('refuses a department without an available agent', async () => {
    const { author, runner } = createAuthor([staffMember('off', { available: false })]);

    const attempt = author.writeWorkflowProposal({
      departmentId: 'dept-1',
      departmentName: 'Dev',
      agentId: undefined,
      mode: DRAFT,
    });

    await expect(attempt).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError && error.code === 'DEPARTMENT_HAS_NO_AVAILABLE_AGENT',
    );
    expect(runner.askAgentOnce).not.toHaveBeenCalled();
  });
});
