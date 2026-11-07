import type { AgentRole } from '@aiteam/contracts';

export interface StaffMember {
  agentId: string;
  role: AgentRole;
  /** Agent and department both switched on. */
  available: boolean;
  positionId: string;
  reportsToPositionId: string | null;
}

/**
 * Who works on a step that needs `role`: the current assignee when it has the role; otherwise
 * someone in the assignee's own team (subordinates first, so work flows down the chain), then
 * anyone in the department. Ties go to the least busy agent. null: nobody available.
 */
export function chooseStepAgent(input: {
  role: AgentRole;
  staff: readonly StaffMember[];
  currentAssigneeId: string | null;
  activeTaskCountByAgent: ReadonlyMap<string, number>;
}): string | null {
  const candidates = input.staff.filter((member) => member.available && member.role === input.role);
  const current = candidates.find((member) => member.agentId === input.currentAssigneeId);
  if (current !== undefined) {
    return current.agentId;
  }
  const assigneePosition = input.staff.find((member) => member.agentId === input.currentAssigneeId);
  const team =
    assigneePosition === undefined
      ? new Set<string>()
      : collectSubordinatePositions(assigneePosition.positionId, input.staff);
  const inTeam = candidates.filter((member) => team.has(member.positionId));
  const pool = inTeam.length > 0 ? inTeam : candidates;
  return leastBusy(pool, input.activeTaskCountByAgent)?.agentId ?? null;
}

/** Direct subordinates of an agent that are available, least busy first. */
export function listDirectSubordinates(
  agentId: string,
  staff: readonly StaffMember[],
): StaffMember[] {
  const position = staff.find((member) => member.agentId === agentId);
  if (position === undefined) return [];
  return staff.filter((member) => member.reportsToPositionId === position.positionId);
}

export function findSuperior(agentId: string, staff: readonly StaffMember[]): StaffMember | null {
  const position = staff.find((member) => member.agentId === agentId);
  if (position === undefined || position.reportsToPositionId === null) return null;
  return staff.find((member) => member.positionId === position.reportsToPositionId) ?? null;
}

export function leastBusy(
  members: readonly StaffMember[],
  activeTaskCountByAgent: ReadonlyMap<string, number>,
): StaffMember | undefined {
  return [...members].sort(
    (first, second) =>
      (activeTaskCountByAgent.get(first.agentId) ?? 0) -
      (activeTaskCountByAgent.get(second.agentId) ?? 0),
  )[0];
}

function collectSubordinatePositions(
  rootPositionId: string,
  staff: readonly StaffMember[],
): Set<string> {
  const found = new Set<string>();
  const pending = [rootPositionId];
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const member of staff) {
      if (member.reportsToPositionId === parent && !found.has(member.positionId)) {
        found.add(member.positionId);
        pending.push(member.positionId);
      }
    }
  }
  return found;
}
