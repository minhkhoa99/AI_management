import type { ApiFormat } from '@aiteam/contracts';
import { DisplayName } from '../../../../shared/domain/display-name';
import { ValidationError } from '../../../../shared/errors/app-error';

export interface ProviderConnectionState {
  id: string;
  name: string;
  format: ApiFormat;
  /** Normalised: no trailing slash. */
  baseUrl: string;
  encryptedKey: string | null;
  keyHint: string | null;
  models: string[];
  defaultModel: string | null;
}

export interface ProviderConnectionDetails {
  name: string;
  format: ApiFormat;
  baseUrl: string;
  models: readonly string[];
  defaultModel: string | null;
}

export interface StoredApiKey {
  encryptedKey: string;
  keyHint: string | null;
}

/** Keys shorter than this get no hint: showing 4 characters would reveal too much of them. */
const MIN_KEY_LENGTH_FOR_HINT = 12;

export class ProviderConnection {
  private constructor(private state: ProviderConnectionState) {}

  static createNew(
    id: string,
    details: ProviderConnectionDetails,
    apiKey: StoredApiKey | null,
  ): ProviderConnection {
    return new ProviderConnection({
      id,
      ...normaliseDetails(details),
      encryptedKey: apiKey?.encryptedKey ?? null,
      keyHint: apiKey?.keyHint ?? null,
    });
  }

  static restore(state: ProviderConnectionState): ProviderConnection {
    return new ProviderConnection({ ...state, models: [...state.models] });
  }

  get id(): string {
    return this.state.id;
  }

  get baseUrl(): string {
    return this.state.baseUrl;
  }

  get encryptedKey(): string | null {
    return this.state.encryptedKey;
  }

  /**
   * Updates the connection. Omitting the key keeps the stored one, except when the host changes:
   * the key must then be typed again, so a key is never silently sent to a new server.
   */
  updateDetails(details: ProviderConnectionDetails, newApiKey: StoredApiKey | null): void {
    const normalised = normaliseDetails(details);
    const hostChanged = new URL(normalised.baseUrl).host !== new URL(this.state.baseUrl).host;
    if (newApiKey === null && hostChanged && this.state.encryptedKey !== null) {
      throw new ValidationError('Đổi máy chủ API thì phải nhập lại khoá API.', {
        code: 'API_KEY_REQUIRED_FOR_NEW_HOST',
      });
    }
    this.state = {
      ...this.state,
      ...normalised,
      encryptedKey: newApiKey?.encryptedKey ?? this.state.encryptedKey,
      keyHint: newApiKey === null ? this.state.keyHint : newApiKey.keyHint,
    };
  }

  toState(): ProviderConnectionState {
    return { ...this.state, models: [...this.state.models] };
  }
}

export function buildKeyHint(plainKey: string): string | null {
  return plainKey.length >= MIN_KEY_LENGTH_FOR_HINT ? plainKey.slice(-4) : null;
}

function normaliseDetails(
  details: ProviderConnectionDetails,
): Omit<ProviderConnectionState, 'id' | 'encryptedKey' | 'keyHint'> {
  const models = [...new Set(details.models.map((model) => model.trim()))];
  if (details.defaultModel !== null && !models.includes(details.defaultModel)) {
    throw new ValidationError('Model mặc định phải nằm trong danh sách model.', {
      code: 'DEFAULT_MODEL_NOT_LISTED',
    });
  }
  return {
    name: DisplayName.parse(details.name, 60, 'CONNECTION_NAME_INVALID').text,
    format: details.format,
    baseUrl: details.baseUrl.trim().replace(/\/+$/, ''),
    models,
    defaultModel: details.defaultModel,
  };
}
