import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { TRACE_ID_HEADER } from '@aiteam/contracts';
import { APP_LOGGER, type AppLogger } from '../logging/app-logger';
import { readOriginalRequestPath } from './request-path';
import { createTraceId, isAcceptableTraceId, runWithTraceContext } from './trace-context';

/**
 * Assigns a traceId to every request, exposes it in the response header, binds it to
 * AsyncLocalStorage for the rest of the request, and writes one access-log line on completion.
 */
@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  constructor(@Inject(APP_LOGGER) private readonly logger: AppLogger) {}

  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const incomingTraceId = request.headers[TRACE_ID_HEADER];
    const traceId = isAcceptableTraceId(incomingTraceId) ? incomingTraceId : createTraceId();
    const startedAt = performance.now();

    response.setHeader(TRACE_ID_HEADER, traceId);
    response.once('finish', () => {
      this.logger.info(
        {
          traceId,
          method: request.method,
          // Path only: the query string may carry the session token.
          path: readOriginalRequestPath(request),
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    });

    runWithTraceContext({ traceId }, next);
  }
}
