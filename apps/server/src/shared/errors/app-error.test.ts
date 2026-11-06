import { HttpException, NotFoundException } from '@nestjs/common';
import { apiErrorResponseSchema } from '@aiteam/contracts';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  EngineAuthError,
  EngineUnavailableError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  ValidationError,
} from './app-error';
import { describeErrorForHttp, resolveHttpStatusForAppError } from './app-exception.filter';

const TRACE_ID = 'trace-0001-test';

describe('AppError hierarchy', () => {
  it.each([
    [new ValidationError('bad input'), 'VALIDATION_FAILED', false, 400],
    [new NotFoundError('missing'), 'NOT_FOUND', false, 404],
    [new PermissionDeniedError('denied'), 'PERMISSION_DENIED', false, 403],
    [new ConflictError('conflict'), 'CONFLICT', false, 409],
    [new EngineUnavailableError('engine down'), 'ENGINE_UNAVAILABLE', true, 503],
    [new EngineAuthError('login expired'), 'ENGINE_AUTH_FAILED', false, 502],
    [new RateLimitedError('slow down', 1500), 'RATE_LIMITED', true, 429],
  ])('%s has code %s, retryable=%s and maps to HTTP %s', (error, code, retryable, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(resolveHttpStatusForAppError(error)).toBe(status);
  });

  it('keeps the subclass name and the original cause', () => {
    const rootCause = new Error('socket hang up');
    const error = new EngineUnavailableError('codex not reachable', { cause: rootCause });

    expect(error.name).toBe('EngineUnavailableError');
    expect(error.cause).toBe(rootCause);
  });

  it('allows a more specific code while keeping the retryable flag of the class', () => {
    const error = new PermissionDeniedError('no token', { code: 'SESSION_TOKEN_INVALID' });

    expect(error.code).toBe('SESSION_TOKEN_INVALID');
    expect(error.retryable).toBe(false);
  });

  it('rejects a negative retryAfterMs', () => {
    expect(() => new RateLimitedError('slow down', -1)).toThrow(RangeError);
  });

  it('maps an unknown AppError subclass to 500', () => {
    const error = new AppError({ code: 'CUSTOM', message: 'x', retryable: false });
    expect(resolveHttpStatusForAppError(error)).toBe(500);
  });
});

describe('describeErrorForHttp', () => {
  it('serialises an AppError into the shared API error contract with traceId', () => {
    const description = describeErrorForHttp(
      new ValidationError('name is required', { details: [{ path: 'name' }] }),
      TRACE_ID,
    );

    expect(description.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(description.body)).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'name is required',
        retryable: false,
        traceId: TRACE_ID,
        details: [{ path: 'name' }],
      },
    });
  });

  it('includes retryAfterMs for rate limits', () => {
    const description = describeErrorForHttp(new RateLimitedError('quota', 2000), TRACE_ID);

    expect(description.statusCode).toBe(429);
    expect(description.body.error).toMatchObject({ retryable: true, retryAfterMs: 2000 });
  });

  it('maps a Nest 404 to ROUTE_NOT_FOUND', () => {
    const description = describeErrorForHttp(new NotFoundException(), TRACE_ID);

    expect(description.statusCode).toBe(404);
    expect(description.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('keeps the status of other HttpExceptions', () => {
    const description = describeErrorForHttp(new HttpException('too large', 413), TRACE_ID);

    expect(description.statusCode).toBe(413);
    expect(description.body.error.code).toBe('HTTP_413');
  });

  it('hides the message of unexpected errors behind a generic 500', () => {
    const description = describeErrorForHttp(new TypeError('secret internal detail'), TRACE_ID);

    expect(description.statusCode).toBe(500);
    expect(description.body.error.code).toBe('INTERNAL_ERROR');
    expect(description.body.error.message).not.toContain('secret internal detail');
    expect(description.body.error.traceId).toBe(TRACE_ID);
  });
});
