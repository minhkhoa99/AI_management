export const PROVIDER_CONNECTION_LOOKUP = Symbol('PROVIDER_CONNECTION_LOOKUP');

/** Read-only check against provider connections (owned by the providers module, phase 2). */
export interface ProviderConnectionLookup {
  connectionExists(connectionId: string): boolean;
}
