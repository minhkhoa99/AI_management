import type { AccessLevel, AgentProvider } from '@aiteam/contracts';

/** Everything that decides how an agent's engine session runs. */
export interface AgentEngineConfiguration {
  provider: AgentProvider;
  connectionId: string | null;
  model: string | null;
  accessLevel: AccessLevel;
  networkAccess: boolean;
  enabled: boolean;
}

export type AgentConfigurationField = keyof AgentEngineConfiguration;

export interface AgentConfigurationChange {
  field: AgentConfigurationField;
  from: AgentEngineConfiguration[AgentConfigurationField];
  to: AgentEngineConfiguration[AgentConfigurationField];
}

const CONFIGURATION_FIELDS: readonly AgentConfigurationField[] = [
  'provider',
  'connectionId',
  'model',
  'accessLevel',
  'networkAccess',
  'enabled',
];

export function describeConfigurationChanges(
  before: AgentEngineConfiguration,
  after: AgentEngineConfiguration,
): AgentConfigurationChange[] {
  return CONFIGURATION_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    from: before[field],
    to: after[field],
  }));
}

/**
 * True when the new configuration takes away something the agent could do before:
 * edit_workspace → read_only, network on → off, or enabled → disabled.
 * A running turn must then be cancelled at once and restarted with the new permissions
 * (docs/IMPLEMENTATION_PLAN.md §5.11). Provider, connection and model changes never reduce
 * permissions; they only affect the next session.
 */
export function reducesPermissions(
  before: AgentEngineConfiguration,
  after: AgentEngineConfiguration,
): boolean {
  const losesWorkspaceEdits =
    before.accessLevel === 'edit_workspace' && after.accessLevel === 'read_only';
  const losesNetwork = before.networkAccess && !after.networkAccess;
  const getsDisabled = before.enabled && !after.enabled;
  return losesWorkspaceEdits || losesNetwork || getsDisabled;
}
