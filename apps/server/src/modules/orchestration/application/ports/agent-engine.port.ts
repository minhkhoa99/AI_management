import type { AccessLevel, AgentEngineEvent, AgentProvider, ApiFormat } from '@aiteam/contracts';

/** Effective permissions of one run: the agent's own flags, capped by engine settings. */
export interface SessionPermissions {
  accessLevel: AccessLevel;
  networkAccess: boolean;
  blockDangerousCommands: boolean;
}

/** Credentials for Custom API engines; never logged, never stored in events. */
export interface ApiConnectionCredentials {
  format: ApiFormat;
  baseUrl: string;
  apiKey: string | null;
}

export interface AgentSessionRequest {
  prompt: string;
  /** Absolute path the engine works in (a task worktree, or a temp dir for test runs). */
  workingDirectory: string;
  /** Root of the task worktree that contains workingDirectory; null for runs outside a task (engine test runs in a throw-away directory). */
  workspaceRoot: string | null;
  model: string | null;
  permissions: SessionPermissions;
  /** Continue an earlier engine session (Claude session id / Codex thread id). */
  resumeSessionRef: string | null;
  apiConnection: ApiConnectionCredentials | null;
}

/**
 * The only thing orchestration knows about engines. A session yields normalised events and
 * always ends with exactly one terminal event: `completed`, `failed` or `cancelled` (after the
 * signal aborts). Engine failures are reported as `failed` events, not thrown.
 */
export interface AgentEnginePort {
  startSession(request: AgentSessionRequest, signal: AbortSignal): AsyncIterable<AgentEngineEvent>;
}

export const AGENT_ENGINE_RESOLVER = Symbol('AGENT_ENGINE_RESOLVER');

export interface AgentEngineResolver {
  resolveAgentEngine(provider: AgentProvider): AgentEnginePort;
}
