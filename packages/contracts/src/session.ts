/** Header carrying the per-launch session token on every API request. */
export const SESSION_TOKEN_HEADER = 'x-aiteam-token';

/** Query parameter used once, in the URL the launcher opens, to hand the token to the browser. */
export const SESSION_TOKEN_QUERY_PARAM = 'token';

/** Response header exposing the request trace id, so UI errors can be matched to logs. */
export const TRACE_ID_HEADER = 'x-trace-id';
