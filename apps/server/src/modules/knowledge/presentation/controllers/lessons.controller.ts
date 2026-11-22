import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
import {
  entityIdSchema,
  lessonListQuerySchema,
  updateLessonRequestSchema,
  type KnowledgeLesson,
  type LessonListQuery,
  type UpdateLessonRequest,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import {
  DeleteLessonUseCase,
  ListLessonsUseCase,
  UpdateLessonUseCase,
} from '../../application/use-cases/lesson.use-cases';

const departmentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã phòng ban');
const lessonIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã bài học');

@Controller('api')
export class LessonsController {
  constructor(
    private readonly listLessonsUseCase: ListLessonsUseCase,
    private readonly updateLessonUseCase: UpdateLessonUseCase,
    private readonly deleteLessonUseCase: DeleteLessonUseCase,
  ) {}

  @Get('departments/:departmentId/lessons')
  listLessons(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Query(new ZodRequestPipe(lessonListQuerySchema)) query: LessonListQuery,
  ): KnowledgeLesson[] {
    return this.listLessonsUseCase.listLessons(departmentId, query.q);
  }

  @Patch('lessons/:lessonId')
  updateLesson(
    @Param('lessonId', lessonIdPipe) lessonId: string,
    @Body(new ZodRequestPipe(updateLessonRequestSchema)) request: UpdateLessonRequest,
  ): KnowledgeLesson {
    return this.updateLessonUseCase.updateLesson(lessonId, request);
  }

  @Delete('lessons/:lessonId')
  @HttpCode(204)
  deleteLesson(@Param('lessonId', lessonIdPipe) lessonId: string): void {
    this.deleteLessonUseCase.deleteLesson(lessonId);
  }
}
