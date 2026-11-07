export const TASK_ATTACHMENT_REPOSITORY = Symbol('TASK_ATTACHMENT_REPOSITORY');

export interface TaskAttachmentRecord {
  id: string;
  taskId: string;
  fileName: string;
  size: number;
  /** Where the bytes are stored, under the data directory. */
  contentPath: string;
  detectedCases: number | null;
}

export interface TaskAttachmentRepository {
  listAttachments(taskId: string): TaskAttachmentRecord[];
  insertAttachment(attachment: TaskAttachmentRecord): void;
  deleteAttachment(attachmentId: string): void;
}
