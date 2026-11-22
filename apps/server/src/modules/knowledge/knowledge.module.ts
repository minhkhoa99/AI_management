import { Module } from '@nestjs/common';
import {
  DescribeTaskKnowledgeUseCase,
  RefreshCodeIndexUseCase,
} from './application/use-cases/code-index.use-cases';
import {
  DeleteLessonUseCase,
  ListLessonsUseCase,
  RecordLessonUseCase,
  UpdateLessonUseCase,
} from './application/use-cases/lesson.use-cases';
import { TaskKnowledgeLibrary } from './application/use-cases/task-knowledge-library';
import { CODE_INDEX_REPOSITORY } from './domain/repositories/code-index.repository';
import { KNOWLEDGE_LESSON_REPOSITORY } from './domain/repositories/knowledge-lesson.repository';
import { SqliteCodeIndexRepository } from './infrastructure/persistence/sqlite-code-index.repository';
import { SqliteKnowledgeLessonRepository } from './infrastructure/persistence/sqlite-knowledge-lesson.repository';
import { LessonsController } from './presentation/controllers/lessons.controller';

/** Knowledge shared per repository: an index of its code and lessons learned from feedback. */
@Module({
  controllers: [LessonsController],
  providers: [
    { provide: CODE_INDEX_REPOSITORY, useClass: SqliteCodeIndexRepository },
    { provide: KNOWLEDGE_LESSON_REPOSITORY, useClass: SqliteKnowledgeLessonRepository },
    RefreshCodeIndexUseCase,
    DescribeTaskKnowledgeUseCase,
    RecordLessonUseCase,
    ListLessonsUseCase,
    UpdateLessonUseCase,
    DeleteLessonUseCase,
    TaskKnowledgeLibrary,
  ],
  exports: [TaskKnowledgeLibrary],
})
export class KnowledgeModule {}
