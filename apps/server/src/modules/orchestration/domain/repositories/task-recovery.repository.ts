export const TASK_RECOVERY_REPOSITORY = Symbol('TASK_RECOVERY_REPOSITORY');

/** Status repair after an abrupt stop. Returns how many tasks were changed. */
export interface TaskRecoveryRepository {
  /** running → queued; session_ref is kept so the next session can resume. */
  requeueRunningTasks(): number;
  /** cancelling → cancelled: the engine process is gone, the cancellation is complete. */
  finishCancellingTasks(): number;
}
