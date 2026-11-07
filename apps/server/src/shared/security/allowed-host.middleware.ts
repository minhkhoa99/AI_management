import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { PermissionDeniedError, ValidationError } from '../errors/app-error';
import { listAllowedHostHeaders } from './session-credentials';

/**
 * Accepts only `Host: 127.0.0.1:<port>` (see UI_HOSTNAME). Blocks DNS-rebinding, where a page on
 * another domain resolves its hostname to 127.0.0.1 to reach this server.
 *
 * Also requires the origin-form request target (`GET /path`). The router accepts the absolute
 * form (`GET http://host/api/x`) and routes it as `/api/x`, while the session check reads the
 * raw target and would not see an API path: such requests must never get that far.
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
      throw new PermissionDeniedError('Chỉ chấp nhận truy cập qua địa chỉ 127.0.0.1.', {
        code: 'HOST_NOT_ALLOWED',
      });
    }
    const requestTarget =
      (request as IncomingMessage & { originalUrl?: string }).originalUrl ?? request.url ?? '';
    if (!requestTarget.startsWith('/')) {
      throw new ValidationError('Đường dẫn yêu cầu phải bắt đầu bằng "/".', {
        code: 'REQUEST_TARGET_NOT_ALLOWED',
      });
    }
    next();
  }
}
