import type { AgentRole } from '@aiteam/contracts';

/** Role names used inside prompts and notes. */
export const ROLE_LABELS_FOR_PROMPTS: Record<AgentRole, string> = {
  // eslint-disable-next-line id-denylist -- role value from AGENT_ROLES (contracts), not a vague name
  manager: 'Manager',
  pm: 'PM',
  dev: 'Dev',
  qc: 'QC',
  designer: 'Designer',
  writer: 'Writer',
  analyst: 'Analyst',
  support: 'Support',
};
