import type { KnowledgeLessonSource } from '@aiteam/contracts';

export const KNOWLEDGE_LESSON_REPOSITORY = Symbol('KNOWLEDGE_LESSON_REPOSITORY');

/** Most lessons a repository keeps; the rarest, oldest one goes first. */
export const LESSONS_PER_PROJECT_MAX = 500;

export interface KnowledgeLessonRecord {
  id: string;
  projectKey: string;
  source: KnowledgeLessonSource;
  body: string;
  paths: string[];
  occurrences: number;
  /** Sequence number of the task it was last learned from; null once that task is gone. */
  sourceTaskSequenceNumber: number | null;
  updatedAt: string;
}

export interface NewKnowledgeLesson {
  id: string;
  projectKey: string;
  departmentId: string;
  sourceTaskId: string;
  source: KnowledgeLessonSource;
  body: string;
  bodyHash: string;
  paths: string[];
}

export interface KnowledgeLessonRepository {
  findLessonById(lessonId: string): KnowledgeLessonRecord | undefined;
  findLessonByHash(projectKey: string, bodyHash: string): KnowledgeLessonRecord | undefined;
  /** Most frequent first, then most recently learned. */
  listProjectLessons(projectKey: string): KnowledgeLessonRecord[];
  /** Lessons of every repository the department's tasks worked in, most frequent first. */
  listDepartmentLessons(departmentId: string): KnowledgeLessonRecord[];
  insertLesson(lesson: NewKnowledgeLesson): void;
  /** The same lesson learned again: one more occurrence, from this task. */
  recordRepeatedLesson(lessonId: string, paths: readonly string[], sourceTaskId: string): void;
  /** Deletes the rarest, oldest lessons above `maxLessons`. */
  trimProjectLessons(projectKey: string, maxLessons: number): void;
  updateLessonBody(lessonId: string, body: string, bodyHash: string): void;
  deleteLesson(lessonId: string): void;
  departmentExists(departmentId: string): boolean;
}
