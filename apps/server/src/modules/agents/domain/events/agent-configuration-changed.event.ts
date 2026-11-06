import type { DomainEvent } from '../../../../shared/events/domain-event';
import type { AgentConfigurationChange } from '../agent-configuration';

export const AGENT_CONFIGURATION_CHANGED = 'AgentConfigurationChanged';

/**
 * Published after an agent's engine configuration is saved. Orchestration (phase 3) reacts:
 * running sessions keep their engine snapshot; `reducesPermissions` cancels the current turn.
 */
export interface AgentConfigurationChanged extends DomainEvent {
  readonly type: typeof AGENT_CONFIGURATION_CHANGED;
  readonly agentId: string;
  readonly changes: readonly AgentConfigurationChange[];
  readonly reducesPermissions: boolean;
}
