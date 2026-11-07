import { Injectable } from '@nestjs/common';

export type TaskRunKind = 'turn' | 'review' | 'tests';
/** Why a activeRun was stopped on purpose: the task is being deleted, or its agent lost permissions. */
export type TaskRunStopReason = 'delete' | 'reconfigure';

interface ActiveTaskRun {
  taskId: string;
  agentId: string | null;
  kind: TaskRunKind;
  stopReason: TaskRunStopReason | null;
  stopRun: (() => void) | null;
  /** Where the agent works (inside the worktree); kept for the gate that follows the turn. */
  workDirectory: string | null;
}

/**
 * Work in progress for each task (one at a time): an agent turn, a superior's review or the
 * test command. Every entry takes one of the parallel slots.
 */
@Injectable()
export class TaskRunRegistry {
  private readonly runs = new Map<string, ActiveTaskRun>();

  /** Reserves the slot before anything slow (git, engine start) happens. */
  reserveRun(
    taskId: string,
    agentId: string | null,
    kind: TaskRunKind,
    workDirectory: string | null = null,
  ): void {
    this.runs.set(taskId, {
      taskId,
      agentId,
      kind,
      stopReason: null,
      stopRun: null,
      workDirectory,
    });
  }

  rememberWorkDirectory(taskId: string, workDirectory: string): void {
    const activeRun = this.runs.get(taskId);
    if (activeRun !== undefined) activeRun.workDirectory = workDirectory;
  }

  workDirectoryOf(taskId: string): string | null {
    return this.runs.get(taskId)?.workDirectory ?? null;
  }

  /** How to stop the activeRun once it exists; called at once if a stop was already asked for. */
  attachStopHandle(taskId: string, stopRun: () => void): void {
    const activeRun = this.runs.get(taskId);
    if (activeRun === undefined) return;
    activeRun.stopRun = stopRun;
    if (activeRun.stopReason !== null) stopRun();
  }

  /** Returns false when the task has nothing running. */
  requestStop(taskId: string, reason: TaskRunStopReason): boolean {
    const activeRun = this.runs.get(taskId);
    if (activeRun === undefined) return false;
    // Deleting wins over a reconfiguration asked for earlier.
    if (activeRun.stopReason !== 'delete') activeRun.stopReason = reason;
    activeRun.stopRun?.();
    return true;
  }

  stopReasonOf(taskId: string): TaskRunStopReason | null {
    return this.runs.get(taskId)?.stopReason ?? null;
  }

  releaseRun(taskId: string): TaskRunStopReason | null {
    const reason = this.runs.get(taskId)?.stopReason ?? null;
    this.runs.delete(taskId);
    return reason;
  }

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId);
  }

  countActiveRuns(): number {
    return this.runs.size;
  }

  listTaskIdsRunBy(agentId: string): string[] {
    return [...this.runs.values()]
      .filter((activeRun) => activeRun.agentId === agentId)
      .map((activeRun) => activeRun.taskId);
  }
}
