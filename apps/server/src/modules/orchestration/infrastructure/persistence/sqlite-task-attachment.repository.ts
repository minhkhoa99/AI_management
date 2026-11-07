import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  TaskAttachmentRecord,
  TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';

interface TaskAttachmentRow {
  id: string;
  task_id: string;
  file_name: string;
  size: number;
  content_path: string;
  detected_cases: number | null;
}

@Injectable()
export class SqliteTaskAttachmentRepository implements TaskAttachmentRepository {
  private readonly selectByTaskStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectByTaskStatement = database.prepare(
      `SELECT id, task_id, file_name, size, content_path, detected_cases
       FROM task_attachments WHERE task_id = ? ORDER BY rowid`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO task_attachments (id, task_id, file_name, size, content_path, detected_cases)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.deleteStatement = database.prepare('DELETE FROM task_attachments WHERE id = ?');
  }

  listAttachments(taskId: string): TaskAttachmentRecord[] {
    const rows = this.selectByTaskStatement.all(taskId) as unknown as TaskAttachmentRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      fileName: row.file_name,
      size: Number(row.size),
      contentPath: row.content_path,
      detectedCases: row.detected_cases === null ? null : Number(row.detected_cases),
    }));
  }

  insertAttachment(attachment: TaskAttachmentRecord): void {
    this.insertStatement.run(
      attachment.id,
      attachment.taskId,
      attachment.fileName,
      attachment.size,
      attachment.contentPath,
      attachment.detectedCases,
    );
  }

  deleteAttachment(attachmentId: string): void {
    this.deleteStatement.run(attachmentId);
  }
}
