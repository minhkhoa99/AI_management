import type { Agent } from '../entities/agent';

export const AGENT_REPOSITORY = Symbol('AGENT_REPOSITORY');

export interface AgentRepository {
  findAgentById(agentId: string): Agent | undefined;
  findAgentsByIds(agentIds: readonly string[]): Agent[];
  insertAgent(agent: Agent): void;
  updateAgent(agent: Agent): void;
  deleteAgent(agentId: string): void;
}
