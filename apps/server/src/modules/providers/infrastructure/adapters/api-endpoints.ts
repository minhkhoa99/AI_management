import type { ApiFormat } from '@aiteam/contracts';

/** Messages API version sent on every Anthropic request (no temperature/top_p/top_k with it). */
export const ANTHROPIC_API_VERSION = '2026-10-21';

export interface ApiTarget {
  format: ApiFormat;
  /** As stored on the connection, without trailing slash. */
  baseUrl: string;
  apiKey: string | null;
}

type ApiOperation = 'list-models' | 'generate';

/**
 * URL and auth headers for an operation. OpenAI-compatible base URLs already include their
 * version segment (https://api.openai.com/v1, http://localhost:11434/v1); for Anthropic the
 * "/v1" is added here, and accepted if the user already typed it.
 */
export function buildApiRequestTarget(
  target: ApiTarget,
  operation: ApiOperation,
): { url: string; headers: Record<string, string> } {
  if (target.format === 'anthropic') {
    const apiRoot = target.baseUrl.replace(/\/v1$/, '');
    const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_API_VERSION };
    if (target.apiKey !== null) {
      headers['x-api-key'] = target.apiKey;
    }
    return {
      url: `${apiRoot}/v1/${operation === 'list-models' ? 'models' : 'messages'}`,
      headers,
    };
  }
  const headers: Record<string, string> = {};
  if (target.apiKey !== null) {
    headers.authorization = `Bearer ${target.apiKey}`;
  }
  return {
    url: `${target.baseUrl}/${operation === 'list-models' ? 'models' : 'chat/completions'}`,
    headers,
  };
}

export function describeApiService(target: Pick<ApiTarget, 'baseUrl'>): string {
  return `API ${new URL(target.baseUrl).host}`;
}
