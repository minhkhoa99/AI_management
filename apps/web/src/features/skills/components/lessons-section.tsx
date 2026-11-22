'use client';

import { useState } from 'react';
import {
  LESSON_BODY_MAX_LENGTH,
  LESSON_SEARCH_MAX_LENGTH,
  type Department,
  type KnowledgeLesson,
} from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { deleteLesson, loadDepartmentLessons, updateLesson } from '../skills-api';
import styles from './skills.module.css';

const LESSON_SOURCE_LABELS: Record<KnowledgeLesson['source'], string> = {
  review_feedback: 'Cấp trên góp ý',
  qc_feedback: 'QC góp ý',
  user_review: 'Người dùng góp ý',
  agent_failure: 'Agent báo lỗi',
  agent_learning: 'Agent tự rút ra',
};

/** Lessons learned in the repositories the department worked in (shared by every department). */
export function LessonsSection({ department }: { department: Department }) {
  const [searchDraft, setSearchDraft] = useState('');
  const [searchText, setSearchText] = useState('');
  const lessons = useApiQuery(`lessons:${department.id}:${searchText}`, () =>
    loadDepartmentLessons(department.id, searchText),
  );
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState('');
  const { outcome, isPending, performAction } = useActionOutcome();

  return (
    <section className={controlStyles.panel} aria-label={`Bài học của ${department.name}`}>
      <div>
        <h2 className={controlStyles.panelTitle}>Bài học rút ra</h2>
        <p className={styles.mutedText}>
          Rút ra từ góp ý khi bước không đạt, dùng chung cho mọi phòng làm cùng repo. Agent nhận các
          bài học liên quan ở mỗi lượt.
        </p>
      </div>
      <form
        className={styles.searchRow}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearchText(searchDraft.trim());
        }}
      >
        <input
          type="search"
          aria-label="Tìm bài học"
          placeholder="Tìm theo từ khoá…"
          className={controlStyles.fieldInput}
          value={searchDraft}
          maxLength={LESSON_SEARCH_MAX_LENGTH}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
        <button type="submit" className={controlStyles.secondaryButton}>
          Tìm
        </button>
      </form>
      <StatusNotice outcome={outcome} />
      {lessons.status === 'loading' && <p className={styles.mutedText}>Đang tải bài học…</p>}
      {lessons.status === 'error' && (
        <StatusNotice outcome={{ tone: 'error', error: lessons.error }} />
      )}
      {lessons.status === 'success' && lessons.result.length === 0 && (
        <p className={styles.mutedText}>
          {searchText === '' ? 'Chưa có bài học nào.' : 'Không có bài học khớp từ khoá.'}
        </p>
      )}
      {lessons.status === 'success' && lessons.result.length > 0 && (
        <ul className={styles.lessonList}>
          {lessons.result.map((lesson) => (
            <li key={lesson.id} className={styles.skillCard}>
              <div className={styles.skillHeader}>
                <span className={styles.sourceBadge}>{LESSON_SOURCE_LABELS[lesson.source]}</span>
                <span className={styles.mutedText}>
                  gặp {lesson.occurrences} lần
                  {lesson.sourceTaskCode !== null && ` · ${lesson.sourceTaskCode}`}
                </span>
              </div>
              {editingLessonId === lesson.id ? (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void performAction(
                      () => updateLesson(lesson.id, bodyDraft),
                      () => 'Đã lưu bài học.',
                    ).then((saved) => {
                      if (saved !== undefined) setEditingLessonId(null);
                    });
                  }}
                >
                  <textarea
                    aria-label="Nội dung bài học"
                    className={styles.contentInput}
                    value={bodyDraft}
                    maxLength={LESSON_BODY_MAX_LENGTH}
                    rows={4}
                    required
                    onChange={(event) => setBodyDraft(event.target.value)}
                  />
                  <div className={controlStyles.buttonRow}>
                    <button
                      type="submit"
                      className={controlStyles.primaryButton}
                      disabled={isPending}
                    >
                      Lưu
                    </button>
                    <button
                      type="button"
                      className={controlStyles.secondaryButton}
                      onClick={() => setEditingLessonId(null)}
                    >
                      Huỷ
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className={styles.lessonBody}>{lesson.body}</p>
                  {lesson.paths.length > 0 && (
                    <span className={styles.sourceUrl}>{lesson.paths.join(', ')}</span>
                  )}
                  <div className={controlStyles.buttonRow}>
                    <button
                      type="button"
                      className={controlStyles.secondaryButton}
                      onClick={() => {
                        setBodyDraft(lesson.body);
                        setEditingLessonId(lesson.id);
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className={controlStyles.dangerButton}
                      disabled={isPending}
                      onClick={() => {
                        if (!window.confirm('Xoá bài học này? Mọi phòng cùng repo sẽ mất nó.'))
                          return;
                        void performAction(
                          () => deleteLesson(lesson.id),
                          () => 'Đã xoá bài học.',
                        );
                      }}
                    >
                      Xoá
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
