import type { ProviderConnection } from '../entities/provider-connection';

export const PROVIDER_CONNECTION_REPOSITORY = Symbol('PROVIDER_CONNECTION_REPOSITORY');

export interface ProviderConnectionRepository {
  listProviderConnections(): ProviderConnection[];
  findProviderConnectionById(connectionId: string): ProviderConnection | undefined;
  insertProviderConnection(connection: ProviderConnection): void;
  updateProviderConnection(connection: ProviderConnection): void;
  deleteProviderConnection(connectionId: string): void;
  /** Names of the agents using each connection (connections without agents are absent). */
  listAgentNamesPerConnection(): Map<string, string[]>;
}
