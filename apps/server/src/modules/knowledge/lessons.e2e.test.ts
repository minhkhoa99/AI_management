import {
  apiErrorResponseSchema,
  departmentSchema,
  knowledgeLessonListSchema,
  knowledgeLessonSchema,
} from '@aiteam/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestApplication,
  TEST_LISTEN_PORT,
  type TestApplication,
} from '../../test-support/test-application';
import { hashLessonBody } from './domain/knowledge-briefing';

describe('lessons API', () => {
  let app: TestApplication;
  let lessonsUrl: string;

  beforeEach(async () => {
    app = await startTestApplication();
    const department = departmentSchema.parse(
      (await app.callApi('POST', '/api/departments', { name: 'Dev', color: '#60A5FA' })).body,
    );
    lessonsUrl = `/api/departments/${department.id}/lessons`;
    app.database
      .prepare(
        `INSERT INTO tasks (id, department_id, title, priority, status, sequence_number, repository_root)
         VALUES ('t1', ?, 'Đăng nhập', 2, 'succeeded', 42, 'D:/repo')`,
      )
      .run(department.id);
    const insertLesson = app.database.prepare(
      `INSERT INTO knowledge_lessons (id, project_key, department_id, source, source_task_id, body, body_hash, occurrences)
       VALUES (?, ?, ?, 'review_feedback', 't1', ?, ?, ?)`,
    );
    insertLesson.run('l1', 'D:/repo', department.id, 'Kiểm tra đăng nhập trước', 'h1', 1);
    insertLesson.run(
      'l2',
      'D:/repo',
      department.id,
      'Đặt tên rõ ràng',
      hashLessonBody('Đặt tên rõ ràng'),
      3,
    );
    insertLesson.run('l3', 'D:/other', null, 'Bài học của repo khác', 'h3', 1);
  });

  afterEach(async () => {
    await app.closeApplication();
  });

  const errorCode = (body: unknown) => apiErrorResponseSchema.parse(body).error.code;

  it("lists the lessons of the department's repositories, most frequent first", async () => {
    const response = await app.callApi('GET', lessonsUrl);

    expect(response.statusCode).toBe(200);
    expect(knowledgeLessonListSchema.parse(response.body)).toEqual([
      expect.objectContaining({ id: 'l2', occurrences: 3, sourceTaskCode: 'T-42' }),
      expect.objectContaining({ id: 'l1', source: 'review_feedback', paths: [] }),
    ]);
  });

  it('searches lessons by keyword', async () => {
    const response = await app.callApi('GET', `${lessonsUrl}?q=dang`);

    expect(knowledgeLessonListSchema.parse(response.body).map((lesson) => lesson.id)).toEqual([
      'l1',
    ]);
  });

  it('edits a lesson, refusing an empty or duplicate body', async () => {
    const empty = await app.callApi('PATCH', '/api/lessons/l1', { body: '' });
    expect(empty.statusCode).toBe(400);

    const duplicate = await app.callApi('PATCH', '/api/lessons/l1', { body: 'đặt tên  RÕ RÀNG' });
    expect(duplicate.statusCode).toBe(409);
    expect(errorCode(duplicate.body)).toBe('LESSON_DUPLICATE');

    const edited = await app.callApi('PATCH', '/api/lessons/l1', { body: 'Kiểm tra quyền' });
    expect(edited.statusCode).toBe(200);
    expect(knowledgeLessonSchema.parse(edited.body).body).toBe('Kiểm tra quyền');

    const missing = await app.callApi('PATCH', '/api/lessons/nope', { body: 'x' });
    expect(missing.statusCode).toBe(404);
    expect(errorCode(missing.body)).toBe('LESSON_NOT_FOUND');
  });

  it('deletes a lesson', async () => {
    const response = await app.callApi('DELETE', '/api/lessons/l1');

    expect(response.statusCode).toBe(204);
    expect(app.database.prepare("SELECT id FROM knowledge_lessons WHERE id = 'l1'").get()).toBe(
      undefined,
    );
  });

  it('requires the session cookie', async () => {
    const response = await app.application.inject({
      method: 'GET',
      url: lessonsUrl,
      headers: { host: `127.0.0.1:${TEST_LISTEN_PORT}` },
    });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response.json())).toBe('SESSION_REQUIRED');
  });
});
