import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError } from '../errors/app-error';
import { listAllowedOrigins } from './session-credentials';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cross-site request forgery guard for state-changing requests: the Origin header must be this
 * app itself. Browsers always send Origin on these methods; a missing Origin is rejected too.
 * (Defence in depth on top of the SameSite=Strict session cookie.)
 */
@Injectable()
export class RequestOriginMiddleware implements NestMiddleware {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.allowedOrigins = listAllowedOrigins(runtimeConfig.listenPort);
  }

  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    if (!STATE_CHANGING_METHODS.has(request.method ?? '')) {
      next();
      return;
    }
    const origin = request.headers.origin?.toLowerCase();
    if (origin === undefined || !this.allowedOrigins.has(origin)) {
      throw new PermissionDeniedError('Yêu cầu ghi phải đến từ chính giao diện AI Team.', {
        code: 'ORIGIN_NOT_ALLOWED',
      });
    }
    next();
  }
}
