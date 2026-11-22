import { DEFAULT_WORKFLOW_RULES, TASK_PRIORITY } from '@aiteam/contracts';
import { describe, expect, it, vi } from 'vitest';
import { Task, type EngineSnapshot } from '../../domain/entities/task';
import { Workflow, type WorkflowStepState } from '../../domain/entities/workflow';
import { TaskProgression } from './task-progression';

const SNAPSHOT: EngineSnapshot = {
  agentId: 'agent-1',
  provider: 'claude_code',
  connectionId: null,
  model: null,
  accessLevel: 'edit_workspace',
  networkAccess: false,
};

function step(id: string, overrides: Partial<WorkflowStepState> = {}): WorkflowStepState {
  return {
    id,
    name: id,
    ownerRole: 'dev',
    gate: 'auto',
    onFail: 'retry',
    returnToStepId: null,
    maxRetries: 2,
    requiredOutput: '',
    handoffDepartmentId: null,
    ...overrides,
  };
}

const workflow = Workflow.restore({
  id: 'wf-1',
  departmentId: 'dept-1',
  name: 'Quy trình',
  description: '',
  isDefault: true,
  enforce: true,
  rules: { ...DEFAULT_WORKFLOW_RULES },
  steps: [
    step('build'),
    step('test', { onFail: 'return_to_step', returnToStepId: 'build' }),
    step('approve', { onFail: 'stop' }),
  ],
});

function setUp() {
  const eventLog = { recordTaskEvent: vi.fn() };
  const progression = new TaskProgression(
    { findWorkflowById: () => workflow } as never,
    eventLog as never,
  );
  return { eventLog, progression };
}

function taskOn(stepId: string): Task {
  const task = Task.createNew({
    id: 'task-1',
    sequenceNumber: 1,
    departmentId: 'dept-1',
    workflowId: 'wf-1',
    assigneeAgentId: 'agent-1',
    workingDirectory: null,
    title: 'Việc',
    description: '',
    criteria: '',
    priority: TASK_PRIORITY.medium,
    testCommand: null,
    previewCommand: null,
  });
  task.startTurn(stepId, SNAPSHOT);
  return task;
}

describe('TaskProgression.applyGateResult', () => {
  it('records the evaluated step on step_passed although the task moved to the next step', () => {
    const { eventLog, progression } = setUp();
    const task = taskOn('build');

    progression.applyGateResult(task, true, null);

    expect(task.toState().currentStepId).toBe('test');
    expect(eventLog.recordTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'step_passed',
        payload: { detail: 'Sang bước "test".', stepId: 'build' },
      }),
    );
  });

  it('records stepId on step_returned, task_failed (stop) and task_succeeded (last step)', () => {
    const { eventLog, progression } = setUp();

    progression.applyGateResult(taskOn('test'), false, 'Thiếu test');
    progression.applyGateResult(taskOn('approve'), false, null);
    progression.applyGateResult(taskOn('approve'), true, null);

    const recorded = eventLog.recordTaskEvent.mock.calls.map(([event]) => [
      (event as { kind: string }).kind,
      (event as { payload: unknown }).payload,
    ]);
    expect(recorded).toEqual([
      ['step_returned', { detail: 'Thiếu test', stepId: 'test' }],
      ['task_failed', { detail: 'Bước "approve" không đạt.', stepId: 'approve' }],
      ['task_succeeded', { detail: null, stepId: 'approve' }],
    ]);
  });

  it('records stepId on step_retried and a null stepId on a free run', () => {
    const { eventLog, progression } = setUp();
    const freeTask = taskOn('build');
    freeTask.startTurn(null, SNAPSHOT);

    progression.applyGateResult(taskOn('build'), false, 'Sai');
    progression.applyGateResult(freeTask, true, null);

    const payloads = eventLog.recordTaskEvent.mock.calls.map(
      ([event]) => (event as { payload: unknown }).payload,
    );
    expect(payloads).toEqual([
      { detail: 'Sai', stepId: 'build' },
      { detail: null, stepId: null },
    ]);
  });
});
