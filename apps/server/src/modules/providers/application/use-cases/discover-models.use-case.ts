import { Inject, Injectable } from '@nestjs/common';
import type { ModelDiscoveryRequest } from '@aiteam/contracts';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { MODEL_CATALOG, type ModelCatalog } from '../ports/model-catalog.port';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { readConnectionApiKey, requireProviderConnection } from './provider-connection-lookup';

/**
 * Lists models before or after saving a connection. The key comes from the form, or from the
 * saved connection, but only when the URL is unchanged: a stored key is never sent elsewhere.
 */
@Injectable()
export class DiscoverModelsUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
    @Inject(MODEL_CATALOG) private readonly modelCatalog: ModelCatalog,
  ) {}

  async discoverModels(request: ModelDiscoveryRequest): Promise<{ models: string[] }> {
    const apiKey = request.apiKey ?? this.readSavedKeyForSameHost(request);
    const models = await this.modelCatalog.listAvailableModels({
      format: request.format,
      baseUrl: request.baseUrl.trim().replace(/\/+$/, ''),
      apiKey,
    });
    return { models };
  }

  private readSavedKeyForSameHost(request: ModelDiscoveryRequest): string | null {
    if (request.connectionId === undefined) {
      return null;
    }
    const connection = requireProviderConnection(this.connectionRepository, request.connectionId);
    if (new URL(connection.baseUrl).host !== new URL(request.baseUrl).host) {
      return null;
    }
    return readConnectionApiKey(this.secretVault, connection);
  }
}
