import type { SkillSourceKind } from '@aiteam/contracts';

export const DEPARTMENT_SKILL_REPOSITORY = Symbol('DEPARTMENT_SKILL_REPOSITORY');

/** Metadata of a skill; its files are in the skill file store. */
export interface DepartmentSkillRecord {
  id: string;
  departmentId: string;
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourceUrl: string | null;
  fileCount: number;
  totalBytes: number;
  updatedAt: string;
}

export interface DepartmentSkillRepository {
  findSkillById(skillId: string): DepartmentSkillRecord | undefined;
  /** Oldest first. */
  listDepartmentSkills(departmentId: string): DepartmentSkillRecord[];
  /** Names are unique within a department (case-insensitive). */
  isSkillNameTaken(departmentId: string, name: string, exceptSkillId: string | null): boolean;
  insertSkill(skill: Omit<DepartmentSkillRecord, 'updatedAt'>): void;
  updateSkill(skill: Omit<DepartmentSkillRecord, 'updatedAt'>): void;
  deleteSkill(skillId: string): void;
  /** Agents allowed to use each skill of the department. */
  listAssignedAgentIds(departmentId: string): Map<string, string[]>;
  /** Skills an agent may use, oldest first. */
  listAgentSkills(agentId: string): DepartmentSkillRecord[];
  /** Replaces the agent's skills in one transaction. */
  replaceAgentSkills(agentId: string, skillIds: readonly string[]): void;
  /** Department of the agent's position, or undefined when it has none. */
  findAgentDepartmentId(agentId: string): string | undefined;
  departmentExists(departmentId: string): boolean;
}
