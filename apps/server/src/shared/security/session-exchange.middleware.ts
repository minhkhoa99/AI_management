import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { SESSION_QUERY_PARAM } from '@aiteam/contracts';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError } from '../errors/app-error';
import { buildSessionCookieHeader, matchesSessionToken } from './session-credentials';

/**
 * Handles the launcher URL `/?session=<token>`: a valid token is exchanged for the HttpOnly
 * session cookie and the browser is redirected to `/`, which removes the token from the address
 * bar and history. An invalid token is rejected. Requests without the parameter pass through.
 */
@Injectable()
export class SessionExchangeMiddleware implements NestMiddleware {
  constructor(@Inject(APP_RUNTIME_CONFIG) private readonly runtimeConfig: AppRuntimeConfig) {}

  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const presentedToken = readSessionQueryParam(request);
    if (presentedToken === undefined || request.method !== 'GET') {
      next();
      return;
    }
    if (!matchesSessionToken(presentedToken, this.runtimeConfig.sessionToken)) {
      throw new PermissionDeniedError(
        'Liên kết phiên không hợp lệ hoặc đã cũ. Chạy lại lệnh aimanagement để mở liên kết mới.',
        { code: 'SESSION_LINK_INVALID' },
      );
    }
    response.statusCode = 303;
    response.setHeader('set-cookie', buildSessionCookieHeader(this.runtimeConfig.sessionToken));
    response.setHeader('location', '/');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.end();
  }
}

function readSessionQueryParam(request: IncomingMessage): string | undefined {
  const originalUrl = (request as IncomingMessage & { originalUrl?: string }).originalUrl;
  const rawUrl = originalUrl ?? request.url ?? '/';
  if (!rawUrl.includes('?')) {
    return undefined;
  }
  // Base is irrelevant: only the query string is read.
  const sessionValue = new URL(rawUrl, 'http://127.0.0.1').searchParams.get(SESSION_QUERY_PARAM);
  return sessionValue ?? undefined;
}
