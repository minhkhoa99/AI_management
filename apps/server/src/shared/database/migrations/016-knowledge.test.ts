import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../migration-runner';
import { IN_MEMORY_DATABASE_LOCATION, openSqliteDatabase } from '../sqlite-connection';
import { ALL_MIGRATIONS } from './index';

describe('migration 016 knowledge', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(
      database,
      ALL_MIGRATIONS.filter((migration) => migration.version < 16),
    );
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO tasks (id, department_id, title, priority, status)
        VALUES ('t1', 'dev', 'Có sẵn', 2, 'queued');
    `);
    applyPendingMigrations(database, ALL_MIGRATIONS);
  });

  afterEach(() => {
    database.close();
  });

  const insertLesson = (id: string, source: string, body: string, bodyHash: string = id) =>
    database
      .prepare(
        "INSERT INTO knowledge_lessons (id, project_key, department_id, source, source_task_id, body, body_hash) VALUES (?, 'repo', 'dev', ?, 't1', ?, ?)",
      )
      .run(id, source, body, bodyHash);

  it('gives existing tasks no repository root', () => {
    expect(database.prepare("SELECT repository_root FROM tasks WHERE id = 't1'").get()).toEqual({
      repository_root: null,
    });
  });

  it('rejects an unknown source and bodies outside 1..1500', () => {
    expect(() => insertLesson('l1', 'other', 'body')).toThrow(/CHECK constraint failed/);
    expect(() => insertLesson('l2', 'review_feedback', '')).toThrow(/CHECK constraint failed/);
    expect(() => insertLesson('l3', 'review_feedback', 'x'.repeat(1501))).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertLesson('l4', 'review_feedback', 'x'.repeat(1500))).not.toThrow();
  });

  it('counts one body once per repository', () => {
    insertLesson('l1', 'qc_feedback', 'Dùng cùng một bài học', 'hash');
    expect(() => insertLesson('l2', 'qc_feedback', 'Dùng cùng một bài học', 'hash')).toThrow(
      /UNIQUE constraint failed/,
    );
    expect(
      database
        .prepare("SELECT occurrences, paths_json FROM knowledge_lessons WHERE id = 'l1'")
        .get(),
    ).toEqual({ occurrences: 1, paths_json: '[]' });
  });

  it('keeps lessons when the department or task is deleted', () => {
    insertLesson('l1', 'agent_failure', 'Bài học');

    database.exec("DELETE FROM tasks WHERE id = 't1'; DELETE FROM departments WHERE id = 'dev';");

    expect(
      database
        .prepare("SELECT department_id, source_task_id FROM knowledge_lessons WHERE id = 'l1'")
        .get(),
    ).toEqual({ department_id: null, source_task_id: null });
  });

  it('stores one import edge once and code files once per path', () => {
    const insertImport = () =>
      database
        .prepare(
          "INSERT INTO code_imports (project_key, from_path, to_path) VALUES ('repo', 'a.ts', 'b.ts')",
        )
        .run();
    insertImport();
    expect(insertImport).toThrow(/UNIQUE constraint failed/);

    const insertFile = () =>
      database
        .prepare(
          "INSERT INTO code_files (project_key, path, blob_sha) VALUES ('repo', 'a.ts', 's')",
        )
        .run();
    insertFile();
    expect(insertFile).toThrow(/UNIQUE constraint failed/);
  });
});
