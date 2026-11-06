import { apiErrorResponseSchema, TRACE_ID_HEADER } from '@aiteam/contracts';
import type { z } from 'zod';

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
 * GET a JSON endpoint and validate the body against the shared zod schema.
 * Writes (POST/PATCH/PUT/DELETE) arrive in later phases; the browser adds the Origin header the
 * server checks on them.
 */
export async function fetchApiJson<Schema extends z.ZodType>(
  path: string,
  responseSchema: Schema,
): Promise<z.infer<Schema>> {
  // Authentication is the HttpOnly session cookie, sent automatically on same-origin requests.
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
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
