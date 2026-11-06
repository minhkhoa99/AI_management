import type { ProviderConnection as ProviderConnectionDto } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import type { ProviderConnection } from '../../domain/entities/provider-connection';
import type { ProviderConnectionRepository } from '../../domain/repositories/provider-connection.repository';
import type { SecretVault } from '../ports/secret-vault.port';

export function requireProviderConnection(
  connectionRepository: ProviderConnectionRepository,
  connectionId: string,
): ProviderConnection {
  const connection = connectionRepository.findProviderConnectionById(connectionId);
  if (connection === undefined) {
    throw new NotFoundError('Không tìm thấy kết nối API.', { code: 'CONNECTION_NOT_FOUND' });
  }
  return connection;
}

/** The API key never leaves the server: the DTO only carries its last 4 characters. */
export function toProviderConnectionDto(
  connection: ProviderConnection,
  agentNames: readonly string[],
): ProviderConnectionDto {
  const state = connection.toState();
  return {
    id: state.id,
    name: state.name,
    format: state.format,
    baseUrl: state.baseUrl,
    keyHint: state.keyHint,
    models: state.models,
    defaultModel: state.defaultModel,
    agentNames: [...agentNames],
  };
}

/** Decrypts the stored key only at the moment a request is sent. */
export function readConnectionApiKey(
  secretVault: SecretVault,
  connection: ProviderConnection,
): string | null {
  return connection.encryptedKey === null
    ? null
    : secretVault.decryptSecret(connection.encryptedKey);
}
