import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../../shared/errors/app-error';
import {
  PROVIDER_CONNECTION_REPOSITORY,
  type ProviderConnectionRepository,
} from '../../domain/repositories/provider-connection.repository';
import { requireProviderConnection } from './provider-connection-lookup';

@Injectable()
export class DeleteProviderConnectionUseCase {
  constructor(
    @Inject(PROVIDER_CONNECTION_REPOSITORY)
    private readonly connectionRepository: ProviderConnectionRepository,
  ) {}

  /** Blocked while agents use the connection: switch their brain first. */
  deleteProviderConnection(connectionId: string): void {
    requireProviderConnection(this.connectionRepository, connectionId);
    const agentNames =
      this.connectionRepository.listAgentNamesPerConnection().get(connectionId) ?? [];
    if (agentNames.length > 0) {
      throw new ConflictError(
        `Kết nối đang được dùng bởi: ${agentNames.join(', ')}. Đổi bộ não của các agent này trước.`,
        { code: 'CONNECTION_IN_USE', details: { agentNames } },
      );
    }
    this.connectionRepository.deleteProviderConnection(connectionId);
  }
}
