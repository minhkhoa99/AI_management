import { Inject, Injectable } from '@nestjs/common';
import type { AddLineCommentRequest, LineComment } from '@aiteam/contracts';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
  LINE_COMMENT_REPOSITORY,
  type LineCommentRepository,
} from '../../domain/repositories/checkpoint.repository';
import { requireCheckpoint } from './checkpoint-lookup';

/** "Góp ý theo dòng": kept on the checkpoint until "Yêu cầu sửa" sends it to the agent. */
@Injectable()
export class AddLineCommentUseCase {
  constructor(
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(LINE_COMMENT_REPOSITORY) private readonly commentRepository: LineCommentRepository,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  addLineComment(checkpointId: string, request: AddLineCommentRequest): LineComment {
    requireCheckpoint(this.checkpointRepository, checkpointId);
    const id = this.idGenerator.generateId();
    this.commentRepository.insertLineComment({
      id,
      checkpointId,
      filePath: request.filePath,
      line: request.line,
      body: request.body,
    });
    const stored = this.commentRepository
      .listLineComments(checkpointId)
      .find((comment) => comment.id === id);
    return (
      stored ?? {
        id,
        checkpointId,
        ...request,
        status: 'open',
        createdAt: new Date().toISOString(),
      }
    );
  }
}
