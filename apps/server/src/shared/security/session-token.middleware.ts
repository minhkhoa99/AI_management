import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { SESSION_TOKEN_HEADER } from '@aiteam/contracts';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError } from '../errors/app-error';
import { readOriginalRequestPath } from '../observability/request-path';

/** API paths reachable without the session token (liveness probes only, no data). */
const PUBLIC_API_PATHS = new Set(['/api/health']);

/**
 * Requires the per-launch session token on every /api request so other web pages open in the
 * same browser cannot call the local API. Static UI files stay public: they contain no data.
 */
@Injectable()
export class SessionTokenMiddleware implements NestMiddleware {
  private readonly expectedToken: Buffer;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.expectedToken = Buffer.from(runtimeConfig.sessionToken, 'utf8');
  }

  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    const path = readOriginalRequestPath(request);
    if (!isApiPath(path) || PUBLIC_API_PATHS.has(path)) {
      next();
      return;
    }
    if (!this.matchesExpectedToken(request.headers[SESSION_TOKEN_HEADER])) {
      throw new PermissionDeniedError(
        'Thiếu hoặc sai token phiên. Hãy mở lại ứng dụng bằng lệnh aiteam.',
        {
          code: 'SESSION_TOKEN_INVALID',
        },
      );
    }
    next();
  }

  private matchesExpectedToken(presentedToken: string | string[] | undefined): boolean {
    if (typeof presentedToken !== 'string') {
      return false;
    }
    const presented = Buffer.from(presentedToken, 'utf8');
    return (
      presented.length === this.expectedToken.length &&
      timingSafeEqual(presented, this.expectedToken)
    );
  }
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}
