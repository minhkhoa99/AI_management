import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE_NAME } from '@aiteam/contracts';

/** Hostnames the browser may use to reach the server (it only binds 127.0.0.1). */
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost'] as const;

/** Exact Host header values accepted for a server listening on `listenPort`. */
export function listAllowedHostHeaders(listenPort: number): ReadonlySet<string> {
  return new Set(LOOPBACK_HOSTNAMES.map((hostname) => `${hostname}:${listenPort}`));
}

/** Exact Origin header values accepted on state-changing requests. */
export function listAllowedOrigins(listenPort: number): ReadonlySet<string> {
  return new Set(LOOPBACK_HOSTNAMES.map((hostname) => `http://${hostname}:${listenPort}`));
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
