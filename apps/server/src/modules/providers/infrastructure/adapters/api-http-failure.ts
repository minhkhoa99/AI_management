import {
  type AppError,
  EngineAuthError,
  EngineUnavailableError,
  RateLimitedError,
  ValidationError,
} from '../../../../shared/errors/app-error';

/** Fallback wait when a 429 carries no usable retry-after header. */
const DEFAULT_RETRY_AFTER_MS = 30_000;
const MAX_ERROR_DETAIL_LENGTH = 300;

/**
 * Maps a failed HTTP response from an OpenAI-compatible or Anthropic API to the app's error
 * classes, keeping the retryable distinction: 429 and 5xx/529 may succeed later, 401/403 need the
 * user to fix credentials, other 4xx mean the request itself is wrong.
 */
export function createApiFailureError(
  status: number,
  retryAfterHeader: string | null,
  responseText: string,
  serviceLabel: string,
): AppError {
  const detail = summariseProviderMessage(responseText);
  if (status === 401 || status === 403) {
    return new EngineAuthError(
      `${serviceLabel} từ chối khoá API (HTTP ${status}). ${detail}`.trim(),
      {
        details: { status },
      },
    );
  }
  if (status === 429) {
    return new RateLimitedError(
      `${serviceLabel} báo vượt hạn mức (HTTP 429). ${detail}`.trim(),
      parseRetryAfterMs(retryAfterHeader),
      { details: { status } },
    );
  }
  if (status >= 500) {
    return new EngineUnavailableError(
      `${serviceLabel} đang lỗi (HTTP ${status}). ${detail}`.trim(),
      {
        details: { status },
      },
    );
  }
  return new ValidationError(`${serviceLabel} từ chối yêu cầu (HTTP ${status}). ${detail}`.trim(), {
    code: 'API_REQUEST_REJECTED',
    details: { status },
  });
}

/** Network failures and timeouts are worth retrying later. */
export function createApiConnectionError(error: unknown, serviceLabel: string): AppError {
  const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
  return new EngineUnavailableError(
    isTimeout
      ? `${serviceLabel} không phản hồi kịp (hết thời gian chờ).`
      : `Không kết nối được tới ${serviceLabel}. Kiểm tra URL và mạng.`,
    { cause: error },
  );
}

export function parseRetryAfterMs(retryAfterHeader: string | null): number {
  if (retryAfterHeader === null) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const retryAt = Date.parse(retryAfterHeader);
  return Number.isNaN(retryAt) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, retryAt - Date.now());
}

/** Provider error body → short readable text (JSON `error.message` when present). */
function summariseProviderMessage(responseText: string): string {
  let message = responseText;
  try {
    const parsed = JSON.parse(responseText) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const candidate =
      typeof parsed.error === 'object' ? parsed.error?.message : (parsed.error ?? parsed.message);
    if (typeof candidate === 'string') {
      message = candidate;
    }
  } catch (parseError) {
    if (!(parseError instanceof SyntaxError)) {
      throw parseError;
    }
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
}
