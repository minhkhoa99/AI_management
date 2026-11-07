import type { AgentProvider, AgentRole, StepGate, TaskStatus } from '@aiteam/contracts';

export const AGENT_TILE_QUERY = Symbol('AGENT_TILE_QUERY');

export interface AgentTileRow {
  agentId: string;
  name: string;
  role: AgentRole;
  provider: AgentProvider;
  available: boolean;
  departmentId: string;
  /** The agent's most pressing task: running, then cancelling, waiting, paused, queued. */
  task: {
    id: string;
    sequenceNumber: number;
    title: string;
    status: TaskStatus;
    workingDirectory: string | null;
    stepName: string | null;
    stepGate: StepGate | null;
    stepPosition: number | null;
    stepCount: number;
  } | null;
  lastEvent: { kind: string; payload: Record<string, unknown>; createdAt: string } | null;
}

export interface AgentTileQuery {
  listAgentTileRows(departmentId: string | undefined): AgentTileRow[];
  /** Same shape for the task an agent is reviewing (it is not the assignee). */
  findTaskRow(taskId: string): AgentTileRow['task'];
  /** Tasks this agent handed down, newest handover first. */
  listDelegatedTaskIds(agentId: string): string[];
}
