import { Inject, Injectable } from '@nestjs/common';
import type { ProviderConnection } from '@aiteam/contracts';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { toProviderConnectionDto } from './provider-connection-lookup';

@Injectable()
export class ListProviderConnectionsUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
  ) {}

  listProviderConnections(): ProviderConnection[] {
    const agentNames = this.connectionRepository.listAgentNamesPerConnection();
    return this.connectionRepository
      .listProviderConnections()
      .map((connection) =>
        toProviderConnectionDto(connection, agentNames.get(connection.id) ?? []),
      );
  }
}
