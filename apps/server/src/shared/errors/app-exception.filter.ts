import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type ApiErrorResponse, TRACE_ID_HEADER } from '@aiteam/contracts';
import { APP_LOGGER, type AppLogger } from '../logging/app-logger';
import { createTraceId, getCurrentTraceContext } from '../observability/trace-context';
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

interface HttpErrorDescription {
  statusCode: number;
  body: ApiErrorResponse;
}

const HTTP_STATUS_BY_ERROR_CLASS: ReadonlyArray<
  readonly [abstract new (...args: never[]) => AppError, number]
> = [
  [ValidationError, 400],
  [PermissionDeniedError, 403],
  [NotFoundError, 404],
  [ConflictError, 409],
  [RateLimitedError, 429],
  [EngineAuthError, 502],
  [EngineUnavailableError, 503],
];

const ROUTE_NOT_FOUND_MESSAGE = 'Không tìm thấy đường dẫn.';
const INTERNAL_ERROR_MESSAGE = 'Lỗi máy chủ nội bộ. Tra log theo traceId để biết chi tiết.';

export function resolveHttpStatusForAppError(error: AppError): number {
  const match = HTTP_STATUS_BY_ERROR_CLASS.find(([errorClass]) => error instanceof errorClass);
  return match?.[1] ?? 500;
}

/** Converts any thrown value into the JSON error contract shared with the web app. */
export function describeErrorForHttp(exception: unknown, traceId: string): HttpErrorDescription {
  if (exception instanceof AppError) {
    return {
      statusCode: resolveHttpStatusForAppError(exception),
      body: {
        error: {
          code: exception.code,
          message: exception.message,
          retryable: exception.retryable,
          traceId,
          ...(exception instanceof RateLimitedError
            ? { retryAfterMs: exception.retryAfterMs }
            : {}),
          ...(exception.details === undefined ? {} : { details: exception.details }),
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    return {
      statusCode,
      body: {
        error: {
          code: statusCode === 404 ? 'ROUTE_NOT_FOUND' : `HTTP_${statusCode}`,
          // Nest's router 404 message embeds the full URL, query string included, and the query
          // string may carry the session token: never echo or log it.
          message: statusCode === 404 ? ROUTE_NOT_FOUND_MESSAGE : exception.message,
          retryable: statusCode >= 500,
          traceId,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, retryable: false, traceId },
    },
  };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    // Errors thrown by middleware arrive with the raw Node response, route errors with a
    // FastifyReply; the adapter API copes with both.
    const response: unknown = host.switchToHttp().getResponse();
    const traceId =
      getCurrentTraceContext()?.traceId ?? readTraceIdFromResponse(response) ?? createTraceId();
    const { statusCode, body } = describeErrorForHttp(exception, traceId);

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, traceId, statusCode },
        'request failed with server error',
      );
    } else {
      this.logger.warn({ traceId, statusCode, code: body.error.code }, body.error.message);
    }

    if (exception instanceof RateLimitedError) {
      httpAdapter.setHeader(
        response,
        'retry-after',
        String(Math.ceil(exception.retryAfterMs / 1000)),
      );
    }
    httpAdapter.setHeader(response, TRACE_ID_HEADER, traceId);
    httpAdapter.reply(response, body, statusCode);
  }
}

/**
 * Exceptions thrown inside middleware propagate outside the AsyncLocalStorage scope, so the
 * trace id is recovered from the response header TraceContextMiddleware already set.
 */
function readTraceIdFromResponse(response: unknown): string | undefined {
  const nodeResponse = hasRawResponse(response) ? response.raw : response;
  if (!hasGetHeader(nodeResponse)) {
    return undefined;
  }
  const headerValue = nodeResponse.getHeader(TRACE_ID_HEADER);
  return typeof headerValue === 'string' ? headerValue : undefined;
}

function hasRawResponse(candidate: unknown): candidate is { raw: unknown } {
  return typeof candidate === 'object' && candidate !== null && 'raw' in candidate;
}

function hasGetHeader(candidate: unknown): candidate is { getHeader(name: string): unknown } {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { getHeader?: unknown }).getHeader === 'function'
  );
}
