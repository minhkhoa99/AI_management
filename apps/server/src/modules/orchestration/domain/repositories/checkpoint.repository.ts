import type { LineCommentStatus } from '@aiteam/contracts';

export const CHECKPOINT_REPOSITORY = Symbol('CHECKPOINT_REPOSITORY');
export const LINE_COMMENT_REPOSITORY = Symbol('LINE_COMMENT_REPOSITORY');

export interface CheckpointRecord {
  id: string;
  taskId: string;
  sha: string;
  /** Step and agent whose turn produced it; a review sends the task back to them. */
  stepId: string | null;
  agentId: string | null;
}

export interface CheckpointView extends CheckpointRecord {
  message: string;
  files: string[];
  agentName: string | null;
  stepName: string | null;
  openCommentCount: number;
  createdAt: string;
}

/** A commit on the task branch after a turn ("mốc"). */
export interface CheckpointRepository {
  insertCheckpoint(input: CheckpointRecord & { message: string; files: readonly string[] }): void;
  /** Newest first. */
  listCheckpoints(taskId: string): CheckpointView[];
  findCheckpoint(checkpointId: string): CheckpointRecord | undefined;
}

export interface LineCommentRecord {
  id: string;
  checkpointId: string;
  filePath: string;
  line: number;
  body: string;
  status: LineCommentStatus;
  createdAt: string;
}

export interface LineCommentRepository {
  insertLineComment(input: Omit<LineCommentRecord, 'status' | 'createdAt'>): void;
  /** In file order, then line. */
  listLineComments(checkpointId: string): LineCommentRecord[];
  changeLineCommentStatus(commentIds: readonly string[], status: LineCommentStatus): void;
}
