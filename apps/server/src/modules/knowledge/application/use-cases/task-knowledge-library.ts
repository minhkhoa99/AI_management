import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeBriefing } from '../../domain/knowledge-briefing';
import {
  KNOWLEDGE_LESSON_REPOSITORY,
  type KnowledgeLessonRepository,
} from '../../domain/repositories/knowledge-lesson.repository';
import {
  DescribeTaskKnowledgeUseCase,
  RefreshCodeIndexUseCase,
  type ReadCodeTree,
} from './code-index.use-cases';
import { RecordLessonUseCase, type LearnedLesson } from './lesson.use-cases';

/**
 * Read by orchestration around each turn (port TASK_KNOWLEDGE, matched by shape): keeps the code
 * index fresh, briefs the turn, and records lessons from feedback.
 */
@Injectable()
export class TaskKnowledgeLibrary {
  constructor(
    private readonly refreshCodeIndexUseCase: RefreshCodeIndexUseCase,
    private readonly describeTaskKnowledgeUseCase: DescribeTaskKnowledgeUseCase,
    private readonly recordLessonUseCase: RecordLessonUseCase,
    @Inject(KNOWLEDGE_LESSON_REPOSITORY)
    private readonly lessonRepository: KnowledgeLessonRepository,
  ) {}

  refreshCodeIndex(projectKey: string, readTree: ReadCodeTree): Promise<void> {
    return this.refreshCodeIndexUseCase.refreshCodeIndex(projectKey, readTree);
  }

  describeTaskKnowledge(input: {
    projectKey: string;
    keywords: readonly string[];
    relatedPaths: readonly string[];
  }): KnowledgeBriefing {
    return this.describeTaskKnowledgeUseCase.describeTaskKnowledge(input);
  }

  recordLesson(lesson: LearnedLesson): void {
    this.recordLessonUseCase.recordLesson(lesson);
  }

  /** Bodies of the most frequent lessons (workflow optimization prompt). */
  listFrequentLessons(projectKey: string, limit: number): string[] {
    return this.lessonRepository
      .listProjectLessons(projectKey)
      .slice(0, limit)
      .map((lesson) => lesson.body);
  }
}
