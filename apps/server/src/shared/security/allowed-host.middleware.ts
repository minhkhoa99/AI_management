import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError } from '../errors/app-error';
import { listAllowedHostHeaders } from './session-credentials';

/**
 * Accepts only `Host: 127.0.0.1:<port>` or `Host: localhost:<port>`. Blocks DNS-rebinding, where
 * a page on another domain resolves its hostname to 127.0.0.1 to reach this server.
 */
@Injectable()
export class AllowedHostMiddleware implements NestMiddleware {
  private readonly allowedHostHeaders: ReadonlySet<string>;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.allowedHostHeaders = listAllowedHostHeaders(runtimeConfig.listenPort);
  }

  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    const hostHeader = request.headers.host?.toLowerCase();
    if (hostHeader === undefined || !this.allowedHostHeaders.has(hostHeader)) {
      throw new PermissionDeniedError('Chỉ chấp nhận truy cập qua 127.0.0.1 hoặc localhost.', {
        code: 'HOST_NOT_ALLOWED',
      });
    }
    next();
  }
}
