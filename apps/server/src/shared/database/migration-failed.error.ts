import { AppError } from '../errors/app-error';

export class MigrationFailedError extends AppError {
  constructor(code: string, message: string, cause?: unknown) {
    super({ code, message, retryable: false, cause });
  }
}
