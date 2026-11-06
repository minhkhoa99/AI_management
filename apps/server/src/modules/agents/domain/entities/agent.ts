import {
  AGENT_NAME_MAX_LENGTH,
  type AccessLevel,
  type AgentProvider,
  type AgentRole,
} from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { DisplayName } from '../../../../shared/domain/display-name';

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

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
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
