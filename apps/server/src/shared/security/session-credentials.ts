import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE_NAME } from '@aiteam/contracts';

/**
 * The one hostname of the UI (the server only binds 127.0.0.1). Browsers send cookies to every
 * port of a host, so the UI never answers on `localhost`: task previews (agent-written dev
 * servers on other ports) are opened on `localhost` and never receive the session cookie.
 */
export const UI_HOSTNAME = '127.0.0.1';

/** Exact Host header values accepted for a server listening on `listenPort`. */
export function listAllowedHostHeaders(listenPort: number): ReadonlySet<string> {
  return new Set([`${UI_HOSTNAME}:${listenPort}`]);
}

/** Exact Origin header values accepted on state-changing requests. */
export function listAllowedOrigins(listenPort: number): ReadonlySet<string> {
  return new Set([`http://${UI_HOSTNAME}:${listenPort}`]);
}

/** Constant-time comparison so the token cannot be guessed byte by byte from response timing. */
export function matchesSessionToken(candidate: string | undefined, expectedToken: string): boolean {
  if (candidate === undefined) {
    return false;
  }
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expectedToken, 'utf8');
  return (
    candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
  );
}

/** Session cookie: unreadable from JavaScript, never sent on cross-site requests. */
export function buildSessionCookieHeader(sessionToken: string): string {
  return `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`;
}

/** Reads one cookie from a Cookie header. Returns undefined when absent or duplicated. */
export function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }
  const matchingValues = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${cookieName}=`))
    .map((pair) => pair.slice(cookieName.length + 1));
  // Two cookies with the same name (e.g. injected by another local site) are ambiguous: reject.
  return matchingValues.length === 1 ? matchingValues[0] : undefined;
}
