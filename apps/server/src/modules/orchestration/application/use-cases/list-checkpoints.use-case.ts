import { Inject, Injectable } from '@nestjs/common';
import type { Checkpoint } from '@aiteam/contracts';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { requireTaskExists } from './get-task-detail.use-case';

/** "Mốc thay đổi của agent": commits on the task branch, newest first. */
@Injectable()
export class ListCheckpointsUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
  ) {}

  listCheckpoints(taskId: string): Checkpoint[] {
    requireTaskExists(this.taskRepository, taskId);
    return this.checkpointRepository.listCheckpoints(taskId).map((checkpoint) => ({
      id: checkpoint.id,
      sha: checkpoint.sha,
      message: checkpoint.message,
      files: checkpoint.files,
      agentName: checkpoint.agentName,
      stepName: checkpoint.stepName,
      openCommentCount: checkpoint.openCommentCount,
      createdAt: checkpoint.createdAt,
    }));
  }
}
