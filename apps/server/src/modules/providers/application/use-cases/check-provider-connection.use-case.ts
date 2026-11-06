import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionCheckResult } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { MODEL_CATALOG, type ModelCatalog } from '../ports/model-catalog.port';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { readConnectionApiKey, requireProviderConnection } from './provider-connection-lookup';

/** Calls the model listing endpoint (no tokens spent) and reports reachability and latency. */
@Injectable()
export class CheckProviderConnectionUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
    @Inject(MODEL_CATALOG) private readonly modelCatalog: ModelCatalog,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  async checkProviderConnection(connectionId: string): Promise<ConnectionCheckResult> {
    const connection = requireProviderConnection(this.connectionRepository, connectionId);
    const state = connection.toState();
    const startedAt = performance.now();
    try {
      const models = await this.modelCatalog.listAvailableModels({
        format: state.format,
        baseUrl: state.baseUrl,
        apiKey: readConnectionApiKey(this.secretVault, connection),
      });
      return {
        reachable: true,
        modelCount: models.length,
        latencyMs: Math.round(performance.now() - startedAt),
        message: `Kết nối được, có ${models.length} model.`,
      };
    } catch (error) {
      // A failed check is the expected answer of this use case, not a server error:
      // known errors become the result, anything else propagates.
      if (!(error instanceof AppError)) {
        throw error;
      }
      this.logger.warn({ connectionId, code: error.code }, 'provider connection check failed');
      return {
        reachable: false,
        modelCount: null,
        latencyMs: Math.round(performance.now() - startedAt),
        message: error.message,
      };
    }
  }
}
