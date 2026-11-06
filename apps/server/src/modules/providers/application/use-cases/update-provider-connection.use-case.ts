import { Inject, Injectable } from '@nestjs/common';
import type {
  ProviderConnection as ProviderConnectionDto,
  SaveProviderConnectionRequest,
} from '@aiteam/contracts';
import { buildKeyHint } from '../../domain/entities/provider-connection';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { requireProviderConnection, toProviderConnectionDto } from './provider-connection-lookup';

@Injectable()
export class UpdateProviderConnectionUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
  ) {}

  /** An omitted apiKey keeps the stored key (unless the host changes, see ProviderConnection). */
  updateProviderConnection(
    connectionId: string,
    request: SaveProviderConnectionRequest,
  ): ProviderConnectionDto {
    const connection = requireProviderConnection(this.connectionRepository, connectionId);
    connection.updateDetails(
      request,
      request.apiKey === undefined
        ? null
        : {
            encryptedKey: this.secretVault.encryptSecret(request.apiKey),
            keyHint: buildKeyHint(request.apiKey),
          },
    );
    this.connectionRepository.updateProviderConnection(connection);
    const agentNames =
      this.connectionRepository.listAgentNamesPerConnection().get(connectionId) ?? [];
    return toProviderConnectionDto(connection, agentNames);
  }
}
