import type { AgentEngineEvent } from '@aiteam/contracts';
import type { AppError } from '../../../../../shared/errors/app-error';

/** Engines report failures as a terminal event (see AgentEnginePort), keeping code + retryable. */
export function toFailedEvent(error: AppError): Extract<AgentEngineEvent, { kind: 'failed' }> {
  return { kind: 'failed', code: error.code, message: error.message, retryable: error.retryable };
}
