import { Inject, Injectable } from '@nestjs/common';
import type { LineComment } from '@aiteam/contracts';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
  LINE_COMMENT_REPOSITORY,
  type LineCommentRepository,
} from '../../domain/repositories/checkpoint.repository';
import { requireCheckpoint } from './checkpoint-lookup';

@Injectable()
export class ListLineCommentsUseCase {
  constructor(
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(LINE_COMMENT_REPOSITORY) private readonly commentRepository: LineCommentRepository,
  ) {}

  listLineComments(checkpointId: string): LineComment[] {
    requireCheckpoint(this.checkpointRepository, checkpointId);
    return this.commentRepository.listLineComments(checkpointId);
  }
}
