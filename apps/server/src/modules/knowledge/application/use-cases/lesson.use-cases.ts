import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type {
  KnowledgeLesson,
  KnowledgeLessonSource,
  UpdateLessonRequest,
} from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { formatTaskCode } from '../../../orchestration/domain/entities/task';
import {
  findMentionedCodePaths,
  hashLessonBody,
  normalizeLessonText,
  scoreTokenOverlap,
  tokenizeSearchText,
} from '../../domain/knowledge-briefing';
import {
  CODE_INDEX_REPOSITORY,
  type CodeIndexRepository,
} from '../../domain/repositories/code-index.repository';
import {
  KNOWLEDGE_LESSON_REPOSITORY,
  LESSONS_PER_PROJECT_MAX,
  type KnowledgeLessonRecord,
  type KnowledgeLessonRepository,
} from '../../domain/repositories/knowledge-lesson.repository';

const LESSON_PATHS_MAX = 10;
const LISTED_LESSONS_MAX = 200;

export interface LearnedLesson {
  projectKey: string;
  departmentId: string;
  sourceTaskId: string;
  source: KnowledgeLessonSource;
  /** Feedback text (agent or user written): cleaned before it is kept. */
  body: string;
  /** The agent's working folder relative to the repository root; null or '' at the root. */
  agentDirectory: string | null;
}

/** Keeps a lesson once per repository: learning it again counts one more occurrence. */
@Injectable()
export class RecordLessonUseCase {
  constructor(
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
    @Inject(CODE_INDEX_REPOSITORY) private readonly codeIndexRepository: CodeIndexRepository,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {}

  recordLesson(lesson: LearnedLesson): void {
    const body = normalizeLessonText(lesson.body);
    if (body === '') return;
    const bodyHash = hashLessonBody(body);
    const paths = this.findIndexedPaths(lesson.projectKey, body, lesson.agentDirectory);
    this.transactionRunner.runInTransaction(() => {
      const existing = this.lessonRepository.findLessonByHash(lesson.projectKey, bodyHash);
      if (existing !== undefined) {
        const mergedPaths = [...new Set([...existing.paths, ...paths])].slice(0, LESSON_PATHS_MAX);
        this.lessonRepository.recordRepeatedLesson(existing.id, mergedPaths, lesson.sourceTaskId);
        return;
      }
      this.lessonRepository.insertLesson({
        id: this.idGenerator.generateId(),
        projectKey: lesson.projectKey,
        departmentId: lesson.departmentId,
        sourceTaskId: lesson.sourceTaskId,
        source: lesson.source,
        body,
        bodyHash,
        paths,
      });
      this.lessonRepository.trimProjectLessons(lesson.projectKey, LESSONS_PER_PROJECT_MAX);
    });
  }

  /**
   * Paths the lesson mentions that are in the index. The agent writes them relative to its
   * folder, so each is tried under that folder first, then from the repository root.
   */
  private findIndexedPaths(
    projectKey: string,
    body: string,
    agentDirectory: string | null,
  ): string[] {
    const directory = (agentDirectory ?? '').replace(/\\/g, '/');
    const found = new Set<string>();
    for (const mentioned of findMentionedCodePaths(body)) {
      const candidates = [path.posix.join(directory, mentioned), path.posix.normalize(mentioned)];
      const indexed = candidates.find((candidate) =>
        this.codeIndexRepository.isFileIndexed(projectKey, candidate),
      );
      if (indexed !== undefined) found.add(indexed);
    }
    return [...found];
  }
}

/** Lessons of the repositories a department worked in: by frequency, or by search score. */
@Injectable()
export class ListLessonsUseCase {
  constructor(
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
  ) {}

  listLessons(departmentId: string, searchText: string): KnowledgeLesson[] {
    if (!this.lessonRepository.departmentExists(departmentId)) {
      throw new NotFoundError('Không tìm thấy phòng ban.', { code: 'DEPARTMENT_NOT_FOUND' });
    }
    const lessons = this.lessonRepository.listDepartmentLessons(departmentId);
    const query = tokenizeSearchText(searchText);
    const ranked =
      searchText.trim() === ''
        ? lessons
        : lessons
            .map((lesson) => ({
              lesson,
              score: scoreTokenOverlap(query, tokenizeSearchText(lesson.body)),
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)
            .map((entry) => entry.lesson);
    return ranked.slice(0, LISTED_LESSONS_MAX).map(presentLesson);
  }
}

@Injectable()
export class UpdateLessonUseCase {
  constructor(
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
  ) {}

  /** The lesson keeps its file links; only its text changes. */
  updateLesson(lessonId: string, request: UpdateLessonRequest): KnowledgeLesson {
    const lesson = requireLesson(this.lessonRepository, lessonId);
    const body = normalizeLessonText(request.body);
    if (body === '') {
      throw new ValidationError('Nhập nội dung bài học', { code: 'LESSON_BODY_EMPTY' });
    }
    const bodyHash = hashLessonBody(body);
    const duplicate = this.lessonRepository.findLessonByHash(lesson.projectKey, bodyHash);
    if (duplicate !== undefined && duplicate.id !== lessonId) {
      throw new ConflictError('Đã có bài học cùng nội dung.', { code: 'LESSON_DUPLICATE' });
    }
    this.lessonRepository.updateLessonBody(lessonId, body, bodyHash);
    return presentLesson(requireLesson(this.lessonRepository, lessonId));
  }
}

@Injectable()
export class DeleteLessonUseCase {
  constructor(
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
  ) {}

  deleteLesson(lessonId: string): void {
    requireLesson(this.lessonRepository, lessonId);
    this.lessonRepository.deleteLesson(lessonId);
  }
}

function requireLesson(
  repository: KnowledgeLessonRepository,
  lessonId: string,
): KnowledgeLessonRecord {
  const lesson = repository.findLessonById(lessonId);
  if (lesson === undefined) {
    throw new NotFoundError('Không tìm thấy bài học.', { code: 'LESSON_NOT_FOUND' });
  }
  return lesson;
}

function presentLesson(lesson: KnowledgeLessonRecord): KnowledgeLesson {
  const { sourceTaskSequenceNumber, ...rest } = lesson;
  return {
    ...rest,
    sourceTaskCode:
      sourceTaskSequenceNumber === null ? null : formatTaskCode(sourceTaskSequenceNumber),
  };
}
