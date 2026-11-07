import { NotFoundError } from '../../../../shared/errors/app-error';
import type {
  CheckpointRecord,
  CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';

export function requireCheckpoint(
  checkpointRepository: CheckpointRepository,
  checkpointId: string,
): CheckpointRecord {
  const checkpoint = checkpointRepository.findCheckpoint(checkpointId);
  if (checkpoint === undefined) {
    throw new NotFoundError('Không tìm thấy mốc thay đổi.', { code: 'CHECKPOINT_NOT_FOUND' });
  }
  return checkpoint;
}
