import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { LineCommentStatus } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  CheckpointRecord,
  CheckpointRepository,
  CheckpointView,
  LineCommentRecord,
  LineCommentRepository,
} from '../../domain/repositories/checkpoint.repository';

@Injectable()
export class SqliteCheckpointRepository implements CheckpointRepository {
  private readonly insertStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly findStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.insertStatement = database.prepare(
      `INSERT INTO checkpoints (id, task_id, sha, message, files_json, step_id, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.listStatement = database.prepare(
      `SELECT c.id, c.task_id, c.sha, c.message, c.files_json, c.step_id, c.agent_id, c.created_at,
              a.name AS agent_name, s.name AS step_name,
              (SELECT COUNT(*) FROM line_comments l
               WHERE l.checkpoint_id = c.id AND l.status = 'open') AS open_comments
       FROM checkpoints c
       LEFT JOIN agents a ON a.id = c.agent_id
       LEFT JOIN workflow_steps s ON s.id = c.step_id
       WHERE c.task_id = ? ORDER BY c.created_at DESC, c.rowid DESC`,
    );
    this.findStatement = database.prepare(
      'SELECT id, task_id, sha, step_id, agent_id FROM checkpoints WHERE id = ?',
    );
  }

  insertCheckpoint(input: CheckpointRecord & { message: string; files: readonly string[] }): void {
    this.insertStatement.run(
      input.id,
      input.taskId,
      input.sha,
      input.message,
      JSON.stringify(input.files),
      input.stepId,
      input.agentId,
    );
  }

  listCheckpoints(taskId: string): CheckpointView[] {
    const rows = this.listStatement.all(taskId) as unknown as Array<{
      id: string;
      task_id: string;
      sha: string;
      message: string;
      files_json: string;
      step_id: string | null;
      agent_id: string | null;
      created_at: string;
      agent_name: string | null;
      step_name: string | null;
      open_comments: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      sha: row.sha,
      message: row.message,
      files: JSON.parse(row.files_json) as string[],
      stepId: row.step_id,
      agentId: row.agent_id,
      createdAt: row.created_at,
      agentName: row.agent_name,
      stepName: row.step_name,
      openCommentCount: Number(row.open_comments),
    }));
  }

  findCheckpoint(checkpointId: string): CheckpointRecord | undefined {
    const row = this.findStatement.get(checkpointId) as
      | {
          id: string;
          task_id: string;
          sha: string;
          step_id: string | null;
          agent_id: string | null;
        }
      | undefined;
    return row === undefined
      ? undefined
      : {
          id: row.id,
          taskId: row.task_id,
          sha: row.sha,
          stepId: row.step_id,
          agentId: row.agent_id,
        };
  }
}

@Injectable()
export class SqliteLineCommentRepository implements LineCommentRepository {
  private readonly insertStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly statusStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.insertStatement = database.prepare(
      'INSERT INTO line_comments (id, checkpoint_id, file_path, line, body) VALUES (?, ?, ?, ?, ?)',
    );
    this.listStatement = database.prepare(
      `SELECT id, checkpoint_id, file_path, line, body, status, created_at FROM line_comments
       WHERE checkpoint_id = ? ORDER BY file_path, line, created_at`,
    );
    this.statusStatement = database.prepare(
      'UPDATE line_comments SET status = ? WHERE id IN (SELECT value FROM json_each(?))',
    );
  }

  insertLineComment(input: Omit<LineCommentRecord, 'status' | 'createdAt'>): void {
    this.insertStatement.run(input.id, input.checkpointId, input.filePath, input.line, input.body);
  }

  listLineComments(checkpointId: string): LineCommentRecord[] {
    const rows = this.listStatement.all(checkpointId) as unknown as Array<{
      id: string;
      checkpoint_id: string;
      file_path: string;
      line: number;
      body: string;
      status: LineCommentStatus;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      checkpointId: row.checkpoint_id,
      filePath: row.file_path,
      line: Number(row.line),
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  changeLineCommentStatus(commentIds: readonly string[], status: LineCommentStatus): void {
    if (commentIds.length > 0) this.statusStatement.run(status, JSON.stringify(commentIds));
  }
}
