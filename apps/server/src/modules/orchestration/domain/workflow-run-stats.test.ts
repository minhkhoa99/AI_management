import { describe, expect, it } from 'vitest';
import { summarizeWorkflowRuns, type WorkflowRunEvent } from './workflow-run-stats';

const STEPS = [{ id: 'build' }, { id: 'test' }, { id: 'approve' }];

let clock = Date.parse('2026-11-01T00:00:00.000Z');
function event(
  kind: string,
  payload: Record<string, unknown>,
  options: { taskId?: string; afterMs?: number } = {},
): WorkflowRunEvent {
  clock += options.afterMs ?? 1_000;
  return {
    taskId: options.taskId ?? 'task-1',
    kind,
    payload,
    createdAt: new Date(clock).toISOString(),
  };
}

function statsOf(stepId: string, events: WorkflowRunEvent[]) {
  return summarizeWorkflowRuns(STEPS, events).find((stats) => stats.stepId === stepId);
}

describe('summarizeWorkflowRuns', () => {
  it('counts outcomes per step by stepId', () => {
    const result = summarizeWorkflowRuns(STEPS, [
      event('step_report', { stepKey: 'build' }),
      event('step_retried', { detail: 'Sai', stepId: 'build' }),
      event('step_report', { stepKey: 'build' }),
      event('step_passed', { detail: 'Sang bước "test".', stepId: 'build' }),
      event('engine_failed', { code: 'X', message: 'y', stepId: 'test' }),
      event('step_report', { stepKey: 'test' }),
      event('step_returned', { detail: 'Thiếu test', stepId: 'test' }),
      event('task_failed', { detail: 'Dừng', stepId: 'approve' }),
      event('task_succeeded', { detail: null, stepId: 'approve' }),
    ]);

    expect(result.map((stats) => stats.stepId)).toEqual(['build', 'test', 'approve']);
    expect(result[0]).toMatchObject({
      turns: 2,
      passed: 1,
      retried: 1,
      returned: 0,
      stopped: 0,
      engineFailures: 0,
      gatePassRate: 0.5,
    });
    expect(result[1]).toMatchObject({ turns: 1, returned: 1, engineFailures: 1, gatePassRate: 0 });
    expect(result[2]).toMatchObject({ turns: 0, passed: 1, stopped: 1, gatePassRate: 0.5 });
  });

  it('attributes old events without stepId to the latest step_report', () => {
    const stats = statsOf('build', [
      event('step_report', { stepKey: 'build' }),
      event('step_passed', { detail: 'Sang bước "test".' }),
      event('step_passed', { detail: 'Sang bước "test".' }, { taskId: 'task-2' }),
    ]);

    expect(stats).toMatchObject({ turns: 1, passed: 1 });
  });

  it('does not attribute an event whose stepId is null', () => {
    const stats = statsOf('build', [
      event('step_report', { stepKey: 'build' }),
      event('task_succeeded', { detail: null, stepId: null }),
      event('step_retried', { detail: 'Sai' }),
    ]);

    expect(stats).toMatchObject({ turns: 1, passed: 0, retried: 0 });
  });

  it('ignores steps no longer in the workflow', () => {
    const result = summarizeWorkflowRuns(STEPS, [
      event('step_report', { stepKey: 'gone' }),
      event('step_passed', { detail: null }),
    ]);

    expect(result.every((stats) => stats.turns === 0 && stats.passed === 0)).toBe(true);
  });

  it('takes the median turn time from turn_started to step_report', () => {
    const odd = statsOf('build', [
      event('turn_started', { stepId: 'build' }),
      event('step_report', { stepKey: 'build' }, { afterMs: 60_000 }),
      event('turn_started', { stepId: 'build' }),
      event('step_report', { stepKey: 'build' }, { afterMs: 180_000 }),
      event('turn_started', { stepId: 'build' }, { taskId: 'task-2' }),
      event('step_report', { stepKey: 'build' }, { taskId: 'task-2', afterMs: 120_000 }),
    ]);
    const even = statsOf('build', [
      event('turn_started', { stepId: 'build' }),
      event('step_report', { stepKey: 'build' }, { afterMs: 60_000 }),
      event('turn_started', { stepId: 'build' }),
      event('step_report', { stepKey: 'build' }, { afterMs: 120_000 }),
    ]);

    expect(odd?.medianTurnMs).toBe(120_000);
    expect(even?.medianTurnMs).toBe(90_000);
  });

  it('reports a step without turns without dividing by zero', () => {
    expect(statsOf('approve', [event('step_report', { stepKey: 'build' })])).toEqual({
      stepId: 'approve',
      turns: 0,
      passed: 0,
      retried: 0,
      returned: 0,
      stopped: 0,
      engineFailures: 0,
      gatePassRate: null,
      medianTurnMs: null,
      recentFeedback: [],
    });
  });

  it('keeps the 3 newest feedback lines, 300 chars each', () => {
    const stats = statsOf('build', [
      event('step_retried', { detail: 'một', stepId: 'build' }),
      event('step_retried', { detail: 'hai', stepId: 'build' }),
      event('step_returned', { detail: '', stepId: 'build' }),
      event('step_retried', { detail: 'ba', stepId: 'build' }),
      event('task_failed', { detail: 'x'.repeat(400), stepId: 'build' }),
      event('step_passed', { detail: 'Sang bước "test".', stepId: 'build' }),
    ]);

    expect(stats?.recentFeedback).toEqual(['x'.repeat(300), 'ba', 'hai']);
  });
});
