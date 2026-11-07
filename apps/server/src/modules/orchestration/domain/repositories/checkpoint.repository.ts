export const CHECKPOINT_REPOSITORY = Symbol('CHECKPOINT_REPOSITORY');

/** A commit on the task branch after a turn ("mốc"); diffs come in phase 4. */
export interface CheckpointRepository {
  insertCheckpoint(input: {
    id: string;
    taskId: string;
    sha: string;
    message: string;
    files: readonly string[];
  }): void;
}
