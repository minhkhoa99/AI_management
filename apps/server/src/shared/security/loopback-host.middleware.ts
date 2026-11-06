import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { PermissionDeniedError } from '../errors/app-error';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Rejects requests whose Host header is not a loopback name. Blocks DNS-rebinding attacks where a
 * web page on another domain resolves its own hostname to 127.0.0.1 to reach this server.
 */
@Injectable()
export class LoopbackHostMiddleware implements NestMiddleware {
  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    if (!isLoopbackHostHeader(request.headers.host)) {
      throw new PermissionDeniedError('Chỉ chấp nhận truy cập qua 127.0.0.1 hoặc localhost.', {
        code: 'HOST_NOT_ALLOWED',
      });
    }
    next();
  }
}

export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return false;
  }
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : (hostHeader.split(':')[0] ?? '');
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}
