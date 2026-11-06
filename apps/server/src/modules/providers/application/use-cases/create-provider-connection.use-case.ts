import { Inject, Injectable } from '@nestjs/common';
import type {
  ProviderConnection as ProviderConnectionDto,
  SaveProviderConnectionRequest,
} from '@aiteam/contracts';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { buildKeyHint, ProviderConnection } from '../../domain/entities/provider-connection';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { SECRET_VAULT, type SecretVault } from '../ports/secret-vault.port';
import { toProviderConnectionDto } from './provider-connection-lookup';

@Injectable()
export class CreateProviderConnectionUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
    @Inject(SECRET_VAULT) private readonly secretVault: SecretVault,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  createProviderConnection(request: SaveProviderConnectionRequest): ProviderConnectionDto {
    const connection = ProviderConnection.createNew(
      this.idGenerator.generateId(),
      request,
      request.apiKey === undefined
        ? null
        : {
            encryptedKey: this.secretVault.encryptSecret(request.apiKey),
            keyHint: buildKeyHint(request.apiKey),
          },
    );
    this.connectionRepository.insertProviderConnection(connection);
    return toProviderConnectionDto(connection, []);
  }
}
