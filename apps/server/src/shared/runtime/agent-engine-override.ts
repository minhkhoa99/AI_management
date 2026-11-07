import type { AgentEnginePort } from '../../modules/orchestration/application/ports/agent-engine.port';

export const AGENT_ENGINE_OVERRIDE = Symbol('AGENT_ENGINE_OVERRIDE');

/**
 * Tests replace every real engine with a scripted one (no CLI, no network). Always null in the
 * running application.
 */
export type AgentEngineOverride = AgentEnginePort | null;

export const TASK_SCHEDULER_ENABLED = Symbol('TASK_SCHEDULER_ENABLED');
