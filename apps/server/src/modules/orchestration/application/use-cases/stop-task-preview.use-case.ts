import { Inject, Injectable } from '@nestjs/common';
import type { PreviewStatus } from '@aiteam/contracts';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { requireTaskExists } from './get-task-detail.use-case';
import { TaskPreviewRegistry } from './task-preview-registry';

/** The page left the preview tab: its dev server stops. */
@Injectable()
export class StopTaskPreviewUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    private readonly previewRegistry: TaskPreviewRegistry,
  ) {}

  stopTaskPreview(taskId: string): PreviewStatus {
    requireTaskExists(this.taskRepository, taskId);
    return this.previewRegistry.stopPreview(taskId);
  }
}
