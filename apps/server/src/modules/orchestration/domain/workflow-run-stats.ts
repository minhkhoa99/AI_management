/** One task event as read for workflow statistics. */
export interface WorkflowRunEvent {
  taskId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** How one workflow step went across the tasks that ran through it. */
export interface WorkflowStepRunStats {
  stepId: string;
  turns: number;
  passed: number;
  retried: number;
  returned: number;
  stopped: number;
  engineFailures: number;
  gatePassRate: number | null;
  medianTurnMs: number | null;
  recentFeedback: string[];
}

const RECENT_FEEDBACK_LIMIT = 3;
const FEEDBACK_MAX_LENGTH = 300;
const FEEDBACK_KINDS = new Set(['step_retried', 'step_returned', 'task_failed']);

interface StepTally {
  stats: WorkflowStepRunStats;
  turnDurationsMs: number[];
  feedback: { createdAt: string; detail: string }[];
}

/**
 * Per-step statistics in the order of `steps`. `events` are grouped by task, oldest first. An
 * event belongs to the step in its `stepId` (null: none), a step_report to its `stepKey`, and any
 * other event (older events have no `stepId`) to the step of the event before it in its task.
 */
export function summarizeWorkflowRuns(
  steps: readonly { id: string }[],
  events: readonly WorkflowRunEvent[],
): WorkflowStepRunStats[] {
  const tallies = new Map<string, StepTally>(
    steps.map((step) => [step.id, emptyTally(step.id)] as const),
  );
  let taskId: string | null = null;
  let stepId: string | null = null;
  let turnStartedAt: string | null = null;
  for (const event of events) {
    if (event.taskId !== taskId) {
      taskId = event.taskId;
      stepId = null;
      turnStartedAt = null;
    }
    stepId = stepOfEvent(event, stepId);
    if (event.kind === 'turn_started') {
      turnStartedAt = event.createdAt;
      continue;
    }
    const tally = stepId === null ? undefined : tallies.get(stepId);
    if (event.kind === 'step_report') {
      if (tally !== undefined && turnStartedAt !== null) {
        tally.turnDurationsMs.push(Date.parse(event.createdAt) - Date.parse(turnStartedAt));
      }
      turnStartedAt = null;
    }
    if (tally !== undefined) countEvent(tally, event);
  }
  return [...tallies.values()].map(finishTally);
}

function stepOfEvent(event: WorkflowRunEvent, previousStepId: string | null): string | null {
  if ('stepId' in event.payload) return asStepId(event.payload.stepId);
  if (event.kind === 'step_report') return asStepId(event.payload.stepKey);
  return previousStepId;
}

function asStepId(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function emptyTally(stepId: string): StepTally {
  return {
    stats: {
      stepId,
      turns: 0,
      passed: 0,
      retried: 0,
      returned: 0,
      stopped: 0,
      engineFailures: 0,
      gatePassRate: null,
      medianTurnMs: null,
      recentFeedback: [],
    },
    turnDurationsMs: [],
    feedback: [],
  };
}

function countEvent(tally: StepTally, event: WorkflowRunEvent): void {
  const { stats } = tally;
  switch (event.kind) {
    case 'step_report':
      stats.turns += 1;
      break;
    case 'step_passed':
    case 'task_succeeded':
      stats.passed += 1;
      break;
    case 'step_retried':
      stats.retried += 1;
      break;
    case 'step_returned':
      stats.returned += 1;
      break;
    case 'task_failed':
      stats.stopped += 1;
      break;
    case 'engine_failed':
      stats.engineFailures += 1;
      break;
  }
  const detail = event.payload.detail;
  if (FEEDBACK_KINDS.has(event.kind) && typeof detail === 'string' && detail !== '') {
    tally.feedback.push({ createdAt: event.createdAt, detail });
  }
}

function finishTally({ stats, turnDurationsMs, feedback }: StepTally): WorkflowStepRunStats {
  const judged = stats.passed + stats.retried + stats.returned + stats.stopped;
  return {
    ...stats,
    gatePassRate: judged === 0 ? null : stats.passed / judged,
    medianTurnMs: median(turnDurationsMs),
    // Events are grouped by task, not by time: the newest feedback is found by its date.
    recentFeedback: feedback
      .reverse()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, RECENT_FEEDBACK_LIMIT)
      .map((entry) => entry.detail.slice(0, FEEDBACK_MAX_LENGTH)),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}
