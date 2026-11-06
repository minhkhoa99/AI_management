import type { IncomingMessage } from 'node:http';

/**
 * Path of the request as the client sent it, percent-decoded, without the query string.
 *
 * - Middleware mounting (@fastify/middie) rewrites `req.url` relative to the mount path, so
 *   `originalUrl` wins.
 * - The router decodes paths before matching, so security checks must compare decoded paths
 *   too (otherwise "/%61pi/x" would be routed as "/api/x" but not recognised as an API call).
 */
export function readOriginalRequestPath(request: IncomingMessage): string {
  const originalUrl = (request as IncomingMessage & { originalUrl?: string }).originalUrl;
  const url = originalUrl ?? request.url ?? '';
  const queryStart = url.indexOf('?');
  const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
  return decodePathOrKeepRaw(rawPath);
}

function decodePathOrKeepRaw(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath);
  } catch (error) {
    if (error instanceof URIError) {
      // Malformed escapes cannot be routed either; checking the raw path is the safe fallback.
      return rawPath;
    }
    throw error;
  }
}
