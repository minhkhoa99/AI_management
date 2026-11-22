import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeLessonSource } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  KnowledgeLessonRecord,
  KnowledgeLessonRepository,
  NewKnowledgeLesson,
} from '../../domain/repositories/knowledge-lesson.repository';

interface LessonRow {
  id: string;
  project_key: string;
  source: KnowledgeLessonSource;
  body: string;
  paths_json: string;
  occurrences: number;
  sequence_number: number | null;
  updated_at: string;
}

const LESSON_SELECT = `SELECT l.id, l.project_key, l.source, l.body, l.paths_json, l.occurrences,
    t.sequence_number, l.updated_at
  FROM knowledge_lessons l LEFT JOIN tasks t ON t.id = l.source_task_id`;
const FREQUENCY_ORDER = 'ORDER BY l.occurrences DESC, l.updated_at DESC, l.rowid DESC';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

@Injectable()
export class SqliteKnowledgeLessonRepository implements KnowledgeLessonRepository {
  private readonly findByIdStatement: StatementSync;
  private readonly findByHashStatement: StatementSync;
  private readonly listProjectStatement: StatementSync;
  private readonly listDepartmentStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly repeatStatement: StatementSync;
  private readonly trimStatement: StatementSync;
  private readonly updateBodyStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly departmentStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.findByIdStatement = database.prepare(`${LESSON_SELECT} WHERE l.id = ?`);
    this.findByHashStatement = database.prepare(
      `${LESSON_SELECT} WHERE l.project_key = ? AND l.body_hash = ?`,
    );
    this.listProjectStatement = database.prepare(
      `${LESSON_SELECT} WHERE l.project_key = ? ${FREQUENCY_ORDER}`,
    );
    this.listDepartmentStatement = database.prepare(
      `${LESSON_SELECT} WHERE l.project_key IN
         (SELECT repository_root FROM tasks WHERE department_id = ?) ${FREQUENCY_ORDER}`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO knowledge_lessons
         (id, project_key, department_id, source, source_task_id, body, body_hash, paths_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.repeatStatement = database.prepare(
      `UPDATE knowledge_lessons SET occurrences = occurrences + 1, paths_json = ?,
         source_task_id = ?, updated_at = ${NOW}
       WHERE id = ?`,
    );
    this.trimStatement = database.prepare(
      `DELETE FROM knowledge_lessons WHERE id IN (
         SELECT id FROM knowledge_lessons WHERE project_key = ?
          ORDER BY occurrences, updated_at, rowid
          LIMIT max(0, (SELECT count(*) FROM knowledge_lessons WHERE project_key = ?) - ?))`,
    );
    this.updateBodyStatement = database.prepare(
      `UPDATE knowledge_lessons SET body = ?, body_hash = ?, updated_at = ${NOW} WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM knowledge_lessons WHERE id = ?');
    this.departmentStatement = database.prepare('SELECT 1 FROM departments WHERE id = ?');
  }

  findLessonById(lessonId: string): KnowledgeLessonRecord | undefined {
    const row = this.findByIdStatement.get(lessonId) as LessonRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  findLessonByHash(projectKey: string, bodyHash: string): KnowledgeLessonRecord | undefined {
    const row = this.findByHashStatement.get(projectKey, bodyHash) as LessonRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  listProjectLessons(projectKey: string): KnowledgeLessonRecord[] {
    return (this.listProjectStatement.all(projectKey) as unknown as LessonRow[]).map(toRecord);
  }

  listDepartmentLessons(departmentId: string): KnowledgeLessonRecord[] {
    return (this.listDepartmentStatement.all(departmentId) as unknown as LessonRow[]).map(toRecord);
  }

  insertLesson(lesson: NewKnowledgeLesson): void {
    this.insertStatement.run(
      lesson.id,
      lesson.projectKey,
      lesson.departmentId,
      lesson.source,
      lesson.sourceTaskId,
      lesson.body,
      lesson.bodyHash,
      JSON.stringify(lesson.paths),
    );
  }

  recordRepeatedLesson(lessonId: string, paths: readonly string[], sourceTaskId: string): void {
    this.repeatStatement.run(JSON.stringify(paths), sourceTaskId, lessonId);
  }

  trimProjectLessons(projectKey: string, maxLessons: number): void {
    this.trimStatement.run(projectKey, projectKey, maxLessons);
  }

  updateLessonBody(lessonId: string, body: string, bodyHash: string): void {
    this.updateBodyStatement.run(body, bodyHash, lessonId);
  }

  deleteLesson(lessonId: string): void {
    this.deleteStatement.run(lessonId);
  }

  departmentExists(departmentId: string): boolean {
    return this.departmentStatement.get(departmentId) !== undefined;
  }
}

function toRecord(row: LessonRow): KnowledgeLessonRecord {
  return {
    id: row.id,
    projectKey: row.project_key,
    source: row.source,
    body: row.body,
    paths: JSON.parse(row.paths_json) as string[],
    occurrences: Number(row.occurrences),
    sourceTaskSequenceNumber: row.sequence_number === null ? null : Number(row.sequence_number),
    updatedAt: row.updated_at,
  };
}
