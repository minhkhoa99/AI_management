import type { LocalEngineSettings } from '@aiteam/contracts';
import type { SessionPermissions } from '../../orchestration/application/ports/agent-engine.port';

export interface AgentPermissionFlags {
  accessLevel: SessionPermissions['accessLevel'];
  networkAccess: boolean;
}

/**
 * Permissions of one run: the agent decides, the engine settings are a ceiling. The agent gets
 * network access only if both allow it; dangerous commands are blocked whenever the engine says
 * so. Custom API engines have no local settings and pass `null`.
 */
export function resolveSessionPermissions(
  agent: AgentPermissionFlags,
  engineSettings: LocalEngineSettings | null,
): SessionPermissions {
  return {
    accessLevel: agent.accessLevel,
    networkAccess: agent.networkAccess && (engineSettings?.allowNetwork ?? true),
    blockDangerousCommands: engineSettings?.blockDangerousCommands ?? true,
  };
}
