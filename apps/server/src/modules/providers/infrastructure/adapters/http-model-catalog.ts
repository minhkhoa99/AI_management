import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { ModelCatalog, ModelCatalogQuery } from '../../application/ports/model-catalog.port';
import { createApiConnectionError, createApiFailureError } from './api-http-failure';
import { buildApiRequestTarget, describeApiService } from './api-endpoints';

const REQUEST_TIMEOUT_MS = 15_000;
/** Anthropic pages; a guard against an endpoint that never stops paging. */
const MAX_PAGES = 10;
const MAX_MODELS = 500;

const modelPageSchema = z.object({
  // eslint-disable-next-line id-denylist -- field name of the provider's JSON response
  data: z.array(z.object({ id: z.string().min(1).max(200) })),
  has_more: z.boolean().optional(),
  last_id: z.string().nullable().optional(),
});

@Injectable()
export class HttpModelCatalog implements ModelCatalog {
  async listAvailableModels(query: ModelCatalogQuery): Promise<string[]> {
    const { url, headers } = buildApiRequestTarget(query, 'list-models');
    const serviceLabel = describeApiService(query);
    const modelIds: string[] = [];
    let afterId: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const pageUrl = new URL(url);
      if (query.format === 'anthropic') {
        pageUrl.searchParams.set('limit', '1000');
        if (afterId !== null) {
          pageUrl.searchParams.set('after_id', afterId);
        }
      }
      const modelPage = await fetchModelPage(pageUrl, headers, serviceLabel);
      modelIds.push(...modelPage.data.map((model) => model.id));
      if (query.format !== 'anthropic' || modelPage.has_more !== true || !modelPage.last_id) {
        break;
      }
      afterId = modelPage.last_id;
    }
    return [...new Set(modelIds)]
      .slice(0, MAX_MODELS)
      .sort((left, right) => left.localeCompare(right));
  }
}

async function fetchModelPage(
  url: URL,
  headers: Record<string, string>,
  serviceLabel: string,
): Promise<z.infer<typeof modelPageSchema>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    throw createApiConnectionError(error, serviceLabel);
  }
  const responseText = await response.text();
  if (!response.ok) {
    throw createApiFailureError(
      response.status,
      response.headers.get('retry-after'),
      responseText,
      serviceLabel,
    );
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText);
  } catch (error) {
    throw new EngineUnavailableError(`${serviceLabel} trả về dữ liệu không phải JSON.`, {
      cause: error,
    });
  }
  const modelPage = modelPageSchema.safeParse(parsedBody);
  if (!modelPage.success) {
    throw new EngineUnavailableError(
      `${serviceLabel} trả về danh sách model không đúng định dạng { data: [{ id }] }.`,
      { code: 'MODEL_LIST_UNEXPECTED' },
    );
  }
  return modelPage.data;
}
