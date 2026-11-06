import { NotFoundError } from '../../../../shared/errors/app-error';

export function createAgentNotFoundError(): NotFoundError {
  return new NotFoundError('Không tìm thấy agent.', { code: 'AGENT_NOT_FOUND' });
}
