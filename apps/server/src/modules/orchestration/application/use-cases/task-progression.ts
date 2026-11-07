import { Inject, Injectable } from '@nestjs/common';
import type { Task } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import { decideNextStep } from '../../domain/step-progression';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';

/** The steps a task follows, or null when it has no enforced workflow (free run). */
export interface TaskRoute {
  steps: readonly WorkflowStepState[];
  allowsSkipping: boolean;
  sensitiveActionsNeedApproval: boolean;
  allowAgentSubsteps: boolean;
}

/** Moves a task through its workflow once a step's gate has been evaluated. */
@Injectable()
export class TaskProgression {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
  ) {}

  /** Steps and rules of the task's workflow; free run when absent, empty or not enforced. */
  resolveTaskRoute(workflowId: string | null): TaskRoute | null {
    const workflow =
      workflowId === null ? undefined : this.workflowRepository.findWorkflowById(workflowId);
    if (workflow === undefined) return null;
    const state = workflow.toState();
    if (!state.enforce || state.steps.length === 0) return null;
    return {
      steps: state.steps,
      allowsSkipping: !state.rules.noSkippingSteps,
      sensitiveActionsNeedApproval: state.rules.sensitiveActionsNeedApproval,
      allowAgentSubsteps: state.rules.allowAgentSubsteps,
    };
  }

  /** Rules of a workflow even when it is not enforced (sensitive actions still need approval). */
  readWorkflowRules(workflowId: string | null) {
    const workflow =
      workflowId === null ? undefined : this.workflowRepository.findWorkflowById(workflowId);
    return workflow?.toState().rules ?? null;
  }

  /**
   * Applies the gate result to the task (the caller saves it). A free run simply succeeds or
   * fails. `feedback` is handed to whoever works on the task next.
   */
  applyGateResult(task: Task, passed: boolean, feedback: string | null): void {
    const state = task.toState();
    const route = this.resolveTaskRoute(state.workflowId);
    if (route === null || state.currentStepId === null) {
      if (passed) {
        task.succeed();
      } else {
        task.fail(feedback ?? 'Không đạt.');
      }
      this.recordOutcome(task, passed ? 'task_succeeded' : 'task_failed', feedback);
      return;
    }

    const decision = decideNextStep(route.steps, state.currentStepId, passed, state.stepAttempt);
    const stepName = (stepId: string | null) =>
      route.steps.find((step) => step.id === stepId)?.name ?? '';
    switch (decision.kind) {
      case 'advance':
        if (decision.nextStepId === null) {
          task.succeed();
          this.recordOutcome(task, 'task_succeeded', null);
        } else {
          // The next step may be someone else: an engine session is not carried over.
          task.forgetEngineSession(null);
          task.requeue({ stepId: decision.nextStepId, retriesUsed: 0 });
          this.recordOutcome(task, 'step_passed', `Sang bước "${stepName(decision.nextStepId)}".`);
        }
        return;
      case 'retry_step':
        if (feedback !== null) task.addFeedback(feedback);
        task.requeue({
          stepId: state.currentStepId,
          retriesUsed: state.stepAttempt + 1,
          note: `Thử lại bước "${stepName(state.currentStepId)}" (lần ${state.stepAttempt + 1}).`,
        });
        this.recordOutcome(task, 'step_retried', feedback);
        return;
      case 'return_to_step':
        if (feedback !== null) task.addFeedback(feedback);
        task.forgetEngineSession(null);
        task.requeue({
          stepId: decision.stepId,
          retriesUsed: 0,
          note: `Quay lại bước "${stepName(decision.stepId)}".`,
        });
        this.recordOutcome(task, 'step_returned', feedback);
        return;
      case 'stop':
        task.fail(feedback === null ? decision.reason : `${decision.reason} ${feedback}`);
        // "Dừng và báo quản lý": the failure is on the board and in the task log.
        this.recordOutcome(task, 'task_failed', decision.reason);
        return;
    }
  }

  private recordOutcome(task: Task, kind: string, detail: string | null): void {
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: task.assigneeAgentId,
      kind,
      payload: { detail },
    });
  }
}
