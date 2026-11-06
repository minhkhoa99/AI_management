import {
  AGENT_NAME_MAX_LENGTH,
  type AccessLevel,
  type AgentProvider,
  type AgentRole,
} from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { DisplayName } from '../../../../shared/domain/display-name';
import {
  type AgentEngineConfiguration,
  describeConfigurationChanges,
  reducesPermissions,
} from '../agent-configuration';
import {
  AGENT_CONFIGURATION_CHANGED,
  type AgentConfigurationChanged,
} from '../events/agent-configuration-changed.event';

export interface AgentState {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  connectionId: string | null;
  model: string | null;
  accessLevel: AccessLevel;
  networkAccess: boolean;
  enabled: boolean;
}

export interface NewAgentInput {
  id: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  connectionId?: string;
  model?: string;
}

/** Requested changes; `undefined` keeps the current value, `null` clears a nullable one. */
export interface AgentConfigurationPatch {
  provider?: AgentProvider;
  connectionId?: string | null;
  model?: string | null;
  accessLevel?: AccessLevel;
  networkAccess?: boolean;
}

export class Agent {
  private constructor(private state: AgentState) {}

  /** New agents start enabled with the least privileges: read-only, no network. */
  static createNew(input: NewAgentInput): Agent {
    const connectionId = input.connectionId ?? null;
    assertConnectionMatchesProvider(input.provider, connectionId);
    return new Agent({
      id: input.id,
      name: parseAgentName(input.name),
      role: input.role,
      provider: input.provider,
      connectionId,
      model: input.model?.trim() || null,
      accessLevel: 'read_only',
      networkAccess: false,
      enabled: true,
    });
  }

  static restore(state: AgentState): Agent {
    return new Agent({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get role(): AgentRole {
    return this.state.role;
  }

  rename(newName: string): void {
    this.state.name = parseAgentName(newName);
  }

  changeRole(newRole: AgentRole): void {
    this.state.role = newRole;
  }

  /** Turning an agent off reduces its permissions, so it is a configuration change too. */
  setEnabled(enabled: boolean): AgentConfigurationChanged | null {
    return this.applyConfiguration({ ...this.readEngineConfiguration(), enabled });
  }

  /**
   * Changes brain and/or permissions. Switching provider or connection resets the model unless a
   * new one is given (a model belongs to its provider); leaving Custom API drops the connection.
   * Returns the event to publish, or null when nothing changed.
   */
  reconfigure(patch: AgentConfigurationPatch): AgentConfigurationChanged | null {
    const current = this.readEngineConfiguration();
    const provider = patch.provider ?? current.provider;
    const providerChanged = provider !== current.provider;
    const connectionId =
      patch.connectionId !== undefined
        ? patch.connectionId
        : provider === 'custom_api' && !providerChanged
          ? current.connectionId
          : null;
    assertConnectionMatchesProvider(provider, connectionId);
    const connectionChanged = connectionId !== current.connectionId;
    const model =
      patch.model !== undefined
        ? patch.model?.trim() || null
        : providerChanged || connectionChanged
          ? null
          : current.model;

    return this.applyConfiguration({
      provider,
      connectionId,
      model,
      accessLevel: patch.accessLevel ?? current.accessLevel,
      networkAccess: patch.networkAccess ?? current.networkAccess,
      enabled: current.enabled,
    });
  }

  readEngineConfiguration(): AgentEngineConfiguration {
    const { provider, connectionId, model, accessLevel, networkAccess, enabled } = this.state;
    return { provider, connectionId, model, accessLevel, networkAccess, enabled };
  }

  private applyConfiguration(next: AgentEngineConfiguration): AgentConfigurationChanged | null {
    const previous = this.readEngineConfiguration();
    const changes = describeConfigurationChanges(previous, next);
    if (changes.length === 0) {
      return null;
    }
    this.state = { ...this.state, ...next };
    return {
      type: AGENT_CONFIGURATION_CHANGED,
      agentId: this.state.id,
      changes,
      reducesPermissions: reducesPermissions(previous, next),
    };
  }

  toState(): AgentState {
    return { ...this.state };
  }
}

function parseAgentName(rawName: string): string {
  return DisplayName.parse(rawName, AGENT_NAME_MAX_LENGTH, 'AGENT_NAME_INVALID').text;
}

/** Custom API agents need a provider connection; local engines (Claude Code, Codex) must not have one. */
function assertConnectionMatchesProvider(
  provider: AgentProvider,
  connectionId: string | null,
): void {
  if (provider === 'custom_api' && connectionId === null) {
    throw new ValidationError('Agent dùng Custom API phải chọn một kết nối API.', {
      code: 'CONNECTION_REQUIRED',
    });
  }
  if (provider !== 'custom_api' && connectionId !== null) {
    throw new ValidationError('Chỉ agent dùng Custom API mới chọn kết nối API.', {
      code: 'CONNECTION_NOT_APPLICABLE',
    });
  }
}
