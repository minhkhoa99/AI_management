import type { ApiFormat } from '@aiteam/contracts';

export const MODEL_CATALOG = Symbol('MODEL_CATALOG');

export interface ModelCatalogQuery {
  format: ApiFormat;
  baseUrl: string;
  apiKey: string | null;
}

/** Lists the model ids a Custom API endpoint offers (GET /models or /v1/models). */
export interface ModelCatalog {
  listAvailableModels(query: ModelCatalogQuery): Promise<string[]>;
}
