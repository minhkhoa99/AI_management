import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, type NestMiddleware } from '@nestjs/common';

/**
 * Sent with every response (UI files, API, errors, SSE):
 * - nothing may frame the UI. Pages on other 127.0.0.1 ports (an agent's dev server opened in a
 *   tab) are same-site, so SameSite=Strict alone would not stop a clickjacking frame;
 * - the UI may only frame task previews, which run on localhost or [::1];
 * - no MIME sniffing, no referrer.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "frame-ancestors 'none'; frame-src http://localhost:* http://[::1]:*; object-src 'none'; base-uri 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** First middleware: the headers are on the raw response before any check can reject. */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: IncomingMessage, response: ServerResponse, next: () => void): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    next();
  }
}
