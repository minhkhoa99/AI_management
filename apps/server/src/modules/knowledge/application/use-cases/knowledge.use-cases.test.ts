import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from '../../../../shared/database/migration-runner';
import { ALL_MIGRATIONS } from '../../../../shared/database/migrations';
import {
  IN_MEMORY_DATABASE_LOCATION,
  openSqliteDatabase,
} from '../../../../shared/database/sqlite-connection';
import { SqliteTransactionRunner } from '../../../../shared/database/transaction-runner';
import { randomUuidGenerator } from '../../../../shared/identifiers/id-generator';
import type { TaskKnowledge } from '../../../orchestration/application/ports/task-execution.ports';
import { SqliteCodeIndexRepository } from '../../infrastructure/persistence/sqlite-code-index.repository';
import { SqliteKnowledgeLessonRepository } from '../../infrastructure/persistence/sqlite-knowledge-lesson.repository';
import { DescribeTaskKnowledgeUseCase, RefreshCodeIndexUseCase } from './code-index.use-cases';
import { ListLessonsUseCase, RecordLessonUseCase, UpdateLessonUseCase } from './lesson.use-cases';
import { TaskKnowledgeLibrary } from './task-knowledge-library';

const PROJECT = 'D:/repo';

interface TreeEntry {
  path: string;
  blobSha: string;
  text: string | null;
}

describe('knowledge use cases', () => {
  let database: DatabaseSync;
  // Typed as the orchestration port: the library must keep matching it by shape.
  let library: TaskKnowledge;
  let updateLessonUseCase: UpdateLessonUseCase;
  let listLessonsUseCase: ListLessonsUseCase;

  beforeEach(() => {
    database = openSqliteDatabase(IN_MEMORY_DATABASE_LOCATION);
    applyPendingMigrations(database, ALL_MIGRATIONS);
    database.exec(`
      INSERT INTO departments (id, name, color) VALUES ('dev', 'Dev', '#3B82F6');
      INSERT INTO tasks (id, department_id, title, priority, status, sequence_number, repository_root)
        VALUES ('t1', 'dev', 'Có sẵn', 2, 'queued', 7, '${PROJECT}');
    `);
    const transactionRunner = new SqliteTransactionRunner(database);
    const codeIndexRepository = new SqliteCodeIndexRepository(database, transactionRunner);
    const lessonRepository = new SqliteKnowledgeLessonRepository(database);
    const recordLessonUseCase = new RecordLessonUseCase(
      lessonRepository,
      codeIndexRepository,
      randomUuidGenerator,
      transactionRunner,
    );
    library = new TaskKnowledgeLibrary(
      new RefreshCodeIndexUseCase(codeIndexRepository),
      new DescribeTaskKnowledgeUseCase(codeIndexRepository, lessonRepository),
      recordLessonUseCase,
      lessonRepository,
    );
    updateLessonUseCase = new UpdateLessonUseCase(lessonRepository);
    listLessonsUseCase = new ListLessonsUseCase(lessonRepository);
  });

  afterEach(() => {
    database.close();
  });

  const refreshWith = (entries: TreeEntry[], seen: Array<ReadonlyMap<string, string>> = []) =>
    library.refreshCodeIndex(PROJECT, (known) => {
      seen.push(new Map(known));
      return Promise.resolve(entries);
    });

  const recordLesson = (body: string, agentDirectory: string | null = null) =>
    library.recordLesson({
      projectKey: PROJECT,
      departmentId: 'dev',
      sourceTaskId: 't1',
      source: 'review_feedback',
      body,
      agentDirectory,
    });

  const allRows = (sql: string) => database.prepare(sql).all();

  it('indexes files and imports, then drops deleted files with their imports', async () => {
    await refreshWith([
      { path: 'src/a.ts', blobSha: 'a1', text: "import { b } from './b';\nexport const a = b;" },
      { path: 'src/b.ts', blobSha: 'b1', text: 'export function b() {}' },
    ]);
    expect(allRows('SELECT from_path, to_path FROM code_imports')).toEqual([
      { from_path: 'src/a.ts', to_path: 'src/b.ts' },
    ]);
    expect(
      allRows("SELECT exported_names, search_terms FROM code_files WHERE path = 'src/b.ts'"),
    ).toEqual([{ exported_names: '["b"]', search_terms: expect.stringContaining('src') }]);

    const seen: Array<ReadonlyMap<string, string>> = [];
    await refreshWith([{ path: 'src/a.ts', blobSha: 'a1', text: null }], seen);

    expect(seen[0]).toEqual(
      new Map([
        ['src/a.ts', 'a1'],
        ['src/b.ts', 'b1'],
      ]),
    );
    expect(allRows('SELECT path FROM code_files')).toEqual([{ path: 'src/a.ts' }]);
    expect(allRows('SELECT * FROM code_imports')).toEqual([]);
  });

  it('keeps the old row of a changed file it could not read this turn', async () => {
    await refreshWith([{ path: 'src/a.ts', blobSha: 'old', text: 'export const a = 1;' }]);
    await refreshWith([{ path: 'src/a.ts', blobSha: 'new', text: null }]);

    expect(allRows('SELECT blob_sha, exported_names FROM code_files')).toEqual([
      { blob_sha: 'old', exported_names: '["a"]' },
    ]);
  });

  it('resolves workspace package imports through package.json names', async () => {
    await refreshWith([
      { path: 'packages/core/package.json', blobSha: 'p1', text: '{"name":"@acme/core"}' },
      { path: 'packages/core/src/index.ts', blobSha: 'c1', text: 'export const core = 1;' },
      { path: 'app/main.ts', blobSha: 'm1', text: "import { core } from '@acme/core';" },
    ]);

    expect(allRows('SELECT from_path, to_path FROM code_imports')).toEqual([
      { from_path: 'app/main.ts', to_path: 'packages/core/src/index.ts' },
    ]);
  });

  it('counts a repeated lesson once and keeps only indexed paths', async () => {
    await refreshWith([{ path: 'src/a.ts', blobSha: 'a1', text: 'export const a = 1;' }]);

    recordLesson('Sai ở src/a.ts và src/zzz.ts');
    recordLesson('  sai ở   SRC/a.ts và src/zzz.ts ');

    expect(allRows('SELECT occurrences, paths_json FROM knowledge_lessons')).toEqual([
      { occurrences: 2, paths_json: '["src/a.ts"]' },
    ]);
  });

  it('links a lesson from a task in a subfolder to the repo-root path', async () => {
    await refreshWith([{ path: 'shop/src/a.ts', blobSha: 'a1', text: 'export const a = 1;' }]);

    recordLesson('Sai ở src/a.ts', 'shop');

    expect(allRows('SELECT paths_json FROM knowledge_lessons')).toEqual([
      { paths_json: '["shop/src/a.ts"]' },
    ]);
  });

  it('ignores a lesson that is empty once cleaned', () => {
    recordLesson('  <aiteam-report></aiteam-report>  ');

    expect(allRows('SELECT id FROM knowledge_lessons')).toEqual([]);
  });

  it('keeps at most 500 lessons per repository, dropping the rarest and oldest', () => {
    for (let index = 0; index < 500; index += 1) {
      recordLesson(`Bài học số ${index}`);
    }
    recordLesson('Bài học số 1');
    recordLesson('Bài học mới nhất');

    const rows = allRows('SELECT body FROM knowledge_lessons') as Array<{ body: string }>;
    expect(rows).toHaveLength(500);
    expect(rows.map((row) => row.body)).toEqual(
      expect.arrayContaining(['Bài học số 1', 'Bài học mới nhất']),
    );
    expect(rows.map((row) => row.body)).not.toContain('Bài học số 0');
  });

  it('briefs lessons tied to the files the task touched even without a keyword match', async () => {
    await refreshWith([
      { path: 'src/a.ts', blobSha: 'a1', text: "import { b } from './b';\nexport const a = b;" },
      { path: 'src/b.ts', blobSha: 'b1', text: 'export function b() {}' },
    ]);
    recordLesson('Nhớ kiểm tra giá trị rỗng trong src/a.ts');
    recordLesson('Một bài học không liên quan');

    const briefing = library.describeTaskKnowledge({
      projectKey: PROJECT,
      keywords: ['zzzz'],
      relatedPaths: ['src/a.ts'],
    });

    expect(briefing.promptSection).toContain('> Nhớ kiểm tra giá trị rỗng trong src/a.ts');
    expect(briefing.promptSection).not.toContain('không liên quan');
    expect(briefing.promptSection).toContain('- src/a.ts | export: a | import: src/b.ts');
    expect(briefing.lessonsMarkdown).toContain('Một bài học không liên quan');
    expect(briefing.codeMapMarkdown).toContain(
      '- src/b.ts | export: b | được import bởi: src/a.ts',
    );
  });

  it('briefs files and lessons that match the keywords', async () => {
    await refreshWith([
      { path: 'src/payment-gateway.ts', blobSha: 'p1', text: 'export class PaymentGateway {}' },
      { path: 'src/other.ts', blobSha: 'o1', text: 'export const other = 1;' },
    ]);
    recordLesson('Cổng payment phải có timeout');

    const briefing = library.describeTaskKnowledge({
      projectKey: PROJECT,
      keywords: ['Sửa lỗi payment gateway'],
      relatedPaths: [],
    });

    expect(briefing.promptSection).toContain('> Cổng payment phải có timeout');
    expect(briefing.promptSection).toContain('- src/payment-gateway.ts');
    expect(briefing.promptSection).not.toContain('src/other.ts');
  });

  it('briefs nothing for an empty project', () => {
    const briefing = library.describeTaskKnowledge({
      projectKey: PROJECT,
      keywords: ['payment'],
      relatedPaths: ['src/a.ts'],
    });

    expect(briefing.promptSection).toBeNull();
  });

  it('lists the most frequent lessons first', () => {
    recordLesson('Bài một');
    recordLesson('Bài hai');
    recordLesson('Bài hai');

    expect(library.listFrequentLessons(PROJECT, 1)).toEqual(['Bài hai']);
  });

  it('lists department lessons by search score, with the source task code', () => {
    recordLesson('Kiểm tra đăng nhập trước');
    recordLesson('Đặt tên rõ ràng');

    expect(listLessonsUseCase.listLessons('dev', 'dang').map((lesson) => lesson.body)).toEqual([
      'Kiểm tra đăng nhập trước',
    ]);
    expect(listLessonsUseCase.listLessons('dev', '')).toEqual([
      expect.objectContaining({ sourceTaskCode: 'T-7', projectKey: PROJECT }),
      expect.objectContaining({ sourceTaskCode: 'T-7' }),
    ]);
  });

  it('refuses an edit that duplicates another lesson', () => {
    recordLesson('Bài học thứ nhất');
    recordLesson('Bài học thứ hai');
    const [first] = listLessonsUseCase.listLessons('dev', 'nhat');

    expect(() =>
      updateLessonUseCase.updateLesson(first?.id ?? '', { body: 'bài học  THỨ HAI' }),
    ).toThrow(expect.objectContaining({ code: 'LESSON_DUPLICATE' }));
    expect(() => updateLessonUseCase.updateLesson('missing', { body: 'x' })).toThrow(
      expect.objectContaining({ code: 'LESSON_NOT_FOUND' }),
    );
    expect(updateLessonUseCase.updateLesson(first?.id ?? '', { body: 'Đã sửa' }).body).toBe(
      'Đã sửa',
    );
  });
});
