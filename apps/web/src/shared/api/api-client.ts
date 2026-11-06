import { apiErrorResponseSchema, TRACE_ID_HEADER } from '@aiteam/contracts';
import type { z } from 'zod';

/** Error raised for any failed API call; carries the server traceId so users can quote it. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly traceId: string | null,
    readonly details?: unknown,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiRequestError';
  }
}

type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** GET a JSON endpoint and validate the body against the shared zod schema. */
export function fetchApiJson<Schema extends z.ZodType>(
  path: string,
  responseSchema: Schema,
): Promise<z.infer<Schema>> {
  return requestApi('GET', path, undefined, responseSchema);
}

/** Write request whose JSON response is validated against `responseSchema`. */
export function sendApiJson<Schema extends z.ZodType>(
  method: WriteMethod,
  path: string,
  requestBody: unknown,
  responseSchema: Schema,
): Promise<z.infer<Schema>> {
  return requestApi(method, path, requestBody, responseSchema);
}

/** Write request answered with 204 No Content. */
export async function sendApiCommand(
  method: WriteMethod,
  path: string,
  requestBody?: unknown,
): Promise<void> {
  await requestApi(method, path, requestBody, undefined);
}

/**
 * Authentication is the HttpOnly session cookie, sent automatically on same-origin requests;
 * the browser adds the Origin header the server checks on writes.
 */
async function requestApi<Schema extends z.ZodType>(
  method: 'GET' | WriteMethod,
  path: string,
  requestBody: unknown,
  responseSchema: Schema | undefined,
): Promise<z.infer<Schema>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (requestBody !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(path, {
    method,
    headers,
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const traceId = response.headers.get(TRACE_ID_HEADER);

  if (response.status === 204) {
    return undefined as z.infer<Schema>;
  }
  const responseBody: unknown = await response.json().catch((parseError: unknown) => {
    throw new ApiRequestError(
      `Phản hồi từ ${path} không phải JSON hợp lệ.`,
      'INVALID_RESPONSE',
      response.status,
      traceId,
      undefined,
      parseError,
    );
  });

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(responseBody);
    if (parsedError.success) {
      const { code, message, details } = parsedError.data.error;
      throw new ApiRequestError(
        message,
        code,
        response.status,
        parsedError.data.error.traceId,
        details,
      );
    }
    throw new ApiRequestError(
      `Yêu cầu ${path} thất bại (HTTP ${response.status}).`,
      `HTTP_${response.status}`,
      response.status,
      traceId,
    );
  }

  if (responseSchema === undefined) {
    return undefined as z.infer<Schema>;
  }
  const parsedBody = responseSchema.safeParse(responseBody);
  if (!parsedBody.success) {
    throw new ApiRequestError(
      `Phản hồi từ ${path} không đúng định dạng mong đợi.`,
      'INVALID_RESPONSE',
      response.status,
      traceId,
    );
  }
  return parsedBody.data;
}
