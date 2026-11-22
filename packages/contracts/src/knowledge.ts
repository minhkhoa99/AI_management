import { z } from 'zod';
import { knowledgeLessonSourceSchema } from './enumerations';
import { entityIdSchema } from './organization';

/** A lesson is a short, general rule; longer feedback is cut. */
export const LESSON_BODY_MAX_LENGTH = 1_500;
export const LESSON_SEARCH_MAX_LENGTH = 200;

/** A lesson learned in one repository, shared by every department working in it. */
export const knowledgeLessonSchema = z.object({
  id: entityIdSchema,
  /** Repository root the lesson belongs to. */
  projectKey: z.string(),
  source: knowledgeLessonSourceSchema,
  body: z.string(),
  /** Indexed code files the lesson mentions. */
  paths: z.array(z.string()),
  /** How many times the same lesson was learned. */
  occurrences: z.number().int().min(1),
  /** Code (T-12) of the task it was last learned from; null once that task is deleted. */
  sourceTaskCode: z.string().nullable(),
  updatedAt: z.string(),
});
export type KnowledgeLesson = z.infer<typeof knowledgeLessonSchema>;
export const knowledgeLessonListSchema = z.array(knowledgeLessonSchema);

export const updateLessonRequestSchema = z
  .object({
    body: z.string().trim().min(1, 'Nhập nội dung bài học').max(LESSON_BODY_MAX_LENGTH),
  })
  .strict();
export type UpdateLessonRequest = z.infer<typeof updateLessonRequestSchema>;

export const lessonListQuerySchema = z
  .object({ q: z.string().trim().max(LESSON_SEARCH_MAX_LENGTH).default('') })
  .strict();
export type LessonListQuery = z.infer<typeof lessonListQuerySchema>;
