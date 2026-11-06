import {
  apiErrorResponseSchema,
  SESSION_TOKEN_HEADER,
  SESSION_TOKEN_QUERY_PARAM,
  TRACE_ID_HEADER,
} from '@aiteam/contracts';
import type { z } from 'zod';

const SESSION_TOKEN_STORAGE_KEY = 'aiteam.sessionToken';

/** Fallback when the browser blocks storage (private mode, strict settings). */
let sessionTokenInMemory: string | null = null;

/** Error raised for any failed API call; carries the server traceId so users can quote it. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly traceId: string | null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiRequestError';
  }
}

/**
 * The launcher opens the app with ?token=…; keep the token for API calls and remove it from the
 * address bar so it does not end up in history, bookmarks or screenshots.
 */
export function captureSessionTokenFromUrl(): void {
  const currentUrl = new URL(window.location.href);
  const token = currentUrl.searchParams.get(SESSION_TOKEN_QUERY_PARAM);
  if (token === null || token.length === 0) {
    return;
  }
  storeSessionToken(token);
  currentUrl.searchParams.delete(SESSION_TOKEN_QUERY_PARAM);
  window.history.replaceState(
    window.history.state,
    '',
    currentUrl.pathname + currentUrl.search + currentUrl.hash,
  );
}

function storeSessionToken(token: string): void {
  sessionTokenInMemory = token;
  try {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch (error) {
    console.warn('Không lưu được token phiên vào trình duyệt; chỉ giữ trong tab này.', error);
  }
}

function readSessionToken(): string | null {
  // A component may fetch before SessionTokenCapture's effect ran; capture lazily as well.
  captureSessionTokenFromUrl();
  if (sessionTokenInMemory !== null) {
    return sessionTokenInMemory;
  }
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn('Không đọc được token phiên từ trình duyệt.', error);
    return null;
  }
}

/** GET a JSON endpoint and validate the body against the shared zod schema. */
export async function fetchApiJson<Schema extends z.ZodType>(
  path: string,
  responseSchema: Schema,
): Promise<z.infer<Schema>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const sessionToken = readSessionToken();
  if (sessionToken !== null) {
    headers[SESSION_TOKEN_HEADER] = sessionToken;
  }

  const response = await fetch(path, { headers, cache: 'no-store' });
  const responseBody: unknown = await response.json().catch((parseError: unknown) => {
    throw new ApiRequestError(
      `Phản hồi từ ${path} không phải JSON hợp lệ.`,
      'INVALID_RESPONSE',
      response.status,
      response.headers.get(TRACE_ID_HEADER),
      parseError,
    );
  });

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(responseBody);
    if (parsedError.success) {
      const { code, message, traceId } = parsedError.data.error;
      throw new ApiRequestError(message, code, response.status, traceId);
    }
    throw new ApiRequestError(
      `Yêu cầu ${path} thất bại (HTTP ${response.status}).`,
      `HTTP_${response.status}`,
      response.status,
      response.headers.get(TRACE_ID_HEADER),
    );
  }

  const parsedBody = responseSchema.safeParse(responseBody);
  if (!parsedBody.success) {
    throw new ApiRequestError(
      `Phản hồi từ ${path} không đúng định dạng mong đợi.`,
      'INVALID_RESPONSE',
      response.status,
      response.headers.get(TRACE_ID_HEADER),
    );
  }
  return parsedBody.data;
}
