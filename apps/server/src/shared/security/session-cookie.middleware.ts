import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { SESSION_COOKIE_NAME } from '@aiteam/contracts';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError } from '../errors/app-error';
import { readOriginalRequestPath } from '../observability/request-path';
import { matchesSessionToken, readCookieValue } from './session-credentials';

/** API paths reachable without a session (liveness probe only, returns no data). */
const PUBLIC_API_PATHS = new Set(['/api/health']);

/**
 * Every /api request (REST and SSE alike) must carry the session cookie set by
 * SessionExchangeMiddleware. Static UI files stay public: they contain no data.
 */
@Injectable()
export class SessionCookieMiddleware implements NestMiddleware {
  constructor(@Inject(APP_RUNTIME_CONFIG) private readonly runtimeConfig: AppRuntimeConfig) {}

  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    const path = readOriginalRequestPath(request);
    if (!isApiPath(path) || PUBLIC_API_PATHS.has(path)) {
      next();
      return;
    }
    const sessionCookie = readCookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!matchesSessionToken(sessionCookie, this.runtimeConfig.sessionToken)) {
      throw new PermissionDeniedError(
        'Chưa đăng nhập hoặc phiên đã hết. Chạy lại lệnh aimanagement để mở liên kết mới.',
        { code: 'SESSION_REQUIRED' },
      );
    }
    next();
  }
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}
