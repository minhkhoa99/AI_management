import { ValidationError } from '../../../../../shared/errors/app-error';

/** Claude session ids and Codex thread ids: UUID-like tokens. */
const SESSION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * A session id comes back from the CLI's own output and is passed to the next run as an argument
 * (`--resume <id>`, `codex exec resume <id>`). Checked so it can never be read as an option.
 */
export function assertEngineSessionRef(sessionRef: string): string {
  if (!SESSION_REF_PATTERN.test(sessionRef)) {
    throw new ValidationError('Mã phiên của engine không hợp lệ; bắt đầu phiên mới.', {
      code: 'ENGINE_SESSION_REF_INVALID',
    });
  }
  return sessionRef;
}
