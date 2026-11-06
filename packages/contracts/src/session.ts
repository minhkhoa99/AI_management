/**
 * Query parameter carrying the per-launch session token in the URL the launcher opens
 * (`/?session=<token>`). The server exchanges it for the session cookie and redirects to `/`.
 */
export const SESSION_QUERY_PARAM = 'session';

/** HttpOnly cookie that authenticates every API and SSE request after the exchange. */
export const SESSION_COOKIE_NAME = 'aiteam_session';

/** Response header exposing the request trace id, so UI errors can be matched to logs. */
export const TRACE_ID_HEADER = 'x-trace-id';

/** Port tried first when no --port / AITEAM_PORT override is given. */
export const DEFAULT_SERVER_PORT = 7419;
