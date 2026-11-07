import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import {
  entityIdSchema,
  type PreviewStatus,
  type StartPreviewRequest,
  startPreviewRequestSchema,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { StartTaskPreviewUseCase } from '../../application/use-cases/start-task-preview.use-case';
import { StopTaskPreviewUseCase } from '../../application/use-cases/stop-task-preview.use-case';

const taskIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã task');

/** Preview tab: the page starts the dev server, renews it while shown, and stops it on leave. */
@Controller('api/tasks/:taskId/preview')
export class PreviewController {
  constructor(
    private readonly startTaskPreviewUseCase: StartTaskPreviewUseCase,
    private readonly stopTaskPreviewUseCase: StopTaskPreviewUseCase,
  ) {}

  @Post()
  @HttpCode(200)
  startTaskPreview(
    @Param('taskId', taskIdPipe) taskId: string,
    @Body(new ZodRequestPipe(startPreviewRequestSchema)) request: StartPreviewRequest,
  ): Promise<PreviewStatus> {
    return this.startTaskPreviewUseCase.startTaskPreview(taskId, request);
  }

  @Delete()
  @HttpCode(200)
  stopTaskPreview(@Param('taskId', taskIdPipe) taskId: string): PreviewStatus {
    return this.stopTaskPreviewUseCase.stopTaskPreview(taskId);
  }
}
