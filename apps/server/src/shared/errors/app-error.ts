export interface AppErrorParams {
  /** Stable, machine-readable error code (UPPER_SNAKE_CASE). */
  code: string;
  message: string;
  /** True when repeating the same operation later may succeed (RetryPolicy relies on it). */
  retryable: boolean;
  cause?: unknown;
  /** Extra, safe-to-expose context (e.g. validation issues). Never put secrets here. */
  details?: unknown;
}

/**
 * Root of every expected application error. Anything that is not an AppError reaching the
 * exception filter is treated as an unexpected bug and answered with a generic 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(params: AppErrorParams) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = new.target.name;
    this.code = params.code;
    this.retryable = params.retryable;
    this.details = params.details;
  }
}

interface SpecificErrorOptions {
  code?: string;
  cause?: unknown;
  details?: unknown;
}

function buildErrorParams(
  defaultCode: string,
  message: string,
  retryable: boolean,
  options: SpecificErrorOptions,
): AppErrorParams {
  return {
    code: options.code ?? defaultCode,
    message,
    retryable,
    cause: options.cause,
    details: options.details,
  };
}

export class ValidationError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('VALIDATION_FAILED', message, false, options));
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('NOT_FOUND', message, false, options));
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('PERMISSION_DENIED', message, false, options));
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('CONFLICT', message, false, options));
  }
}

/** The agent engine (CLI or HTTP API) cannot be reached right now; retrying later may work. */
export class EngineUnavailableError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('ENGINE_UNAVAILABLE', message, true, options));
  }
}

/** The engine rejected our credentials or login; retrying without user action is pointless. */
export class EngineAuthError extends AppError {
  constructor(message: string, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('ENGINE_AUTH_FAILED', message, false, options));
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, options: SpecificErrorOptions = {}) {
    super(buildErrorParams('RATE_LIMITED', message, true, options));
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
      throw new RangeError(
        `retryAfterMs must be a non-negative finite number, got ${retryAfterMs}`,
      );
    }
    this.retryAfterMs = Math.round(retryAfterMs);
  }
}
