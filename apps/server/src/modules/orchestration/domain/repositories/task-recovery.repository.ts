export const TASK_RECOVERY_REPOSITORY = Symbol('TASK_RECOVERY_REPOSITORY');

/** What a task interrupted mid-turn shows the user and tells its agent on the next turn. */
export interface InterruptionNotice {
  statusNote: string;
  /** Appended to the pending feedback, kept to the last `feedbackMaxLength` characters. */
  agentFeedback: string;
  feedbackMaxLength: number;
}

/** Status repair after an abrupt stop. Returns how many tasks were changed. */
export interface TaskRecoveryRepository {
  /**
   * running → queued with the interruption notice; session_ref is kept so the next session can
   * resume.
   */
  requeueRunningTasks(notice: InterruptionNotice): number;
  /** cancelling → cancelled: the engine process is gone, the cancellation is complete. */
  finishCancellingTasks(): number;
}
