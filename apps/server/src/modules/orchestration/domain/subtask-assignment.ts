import type { AgentRole } from '@aiteam/contracts';
import type { SubtaskRequest } from './agent-report';

/** All rounds together: a parent that keeps splitting is stopped after this many subtasks. */
export const MAX_SUBTASKS_PER_TASK = 10;

export interface SubtaskCandidate {
  agentId: string;
  name: string;
  role: AgentRole;
}

export interface SubtaskAssignment {
  request: SubtaskRequest;
  agentId: string;
}

/**
 * Who does each subtask: the subordinate the agent named (exact name, case-insensitive), else the
 * least busy one. Counts grow as subtasks are handed out, so unnamed work is spread out. Only
 * `candidates` (available direct subordinates) can ever be chosen; an unknown name is ignored.
 */
export function assignSubtasks(
  requests: readonly SubtaskRequest[],
  candidates: readonly SubtaskCandidate[],
  activeTaskCountByAgent: ReadonlyMap<string, number>,
): SubtaskAssignment[] {
  if (candidates.length === 0) return [];
  const load = new Map(
    candidates.map((candidate) => [
      candidate.agentId,
      activeTaskCountByAgent.get(candidate.agentId) ?? 0,
    ]),
  );
  return requests.map((request) => {
    const wanted = request.assignee?.trim().toLowerCase();
    const named = candidates.find((candidate) => candidate.name.trim().toLowerCase() === wanted);
    const chosen =
      named ??
      [...candidates].sort(
        (first, second) => (load.get(first.agentId) ?? 0) - (load.get(second.agentId) ?? 0),
      )[0]!;
    load.set(chosen.agentId, (load.get(chosen.agentId) ?? 0) + 1);
    return { request, agentId: chosen.agentId };
  });
}
