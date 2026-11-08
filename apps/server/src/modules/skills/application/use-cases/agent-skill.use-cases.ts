import { Inject, Injectable } from '@nestjs/common';
import type { DepartmentSkill } from '@aiteam/contracts';
import { NotFoundError, ValidationError } from '../../../../shared/errors/app-error';
import {
  DEPARTMENT_SKILL_REPOSITORY,
  type DepartmentSkillRepository,
} from '../../domain/repositories/department-skill.repository';
import { toSkillSlug } from '../../domain/skill-manifest';
import { SKILL_FILE_STORE, type SkillFileStore } from '../ports/skill-file-store.port';
import { SkillCatalog } from './skill-catalog';

/** A skill an agent may use in a run, ready to be copied into its worktree. */
export interface AgentSkillFolder {
  skillId: string;
  name: string;
  description: string;
  /** Folder name in the worktree (.aiteam-skills/<slug>), unique among the agent's skills. */
  slug: string;
  /** Where the platform keeps the skill's files. */
  folder: string;
}

function requireAgentDepartment(repository: DepartmentSkillRepository, agentId: string): string {
  const departmentId = repository.findAgentDepartmentId(agentId);
  if (departmentId === undefined) {
    throw new NotFoundError('Agent không thuộc phòng ban nào.', {
      code: 'AGENT_NOT_IN_DEPARTMENT',
    });
  }
  return departmentId;
}

@Injectable()
export class ListAgentSkillsUseCase {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  listAgentSkills(agentId: string): DepartmentSkill[] {
    requireAgentDepartment(this.skillRepository, agentId);
    return this.skillRepository
      .listAgentSkills(agentId)
      .map((skill) => this.skillCatalog.presentSkill(skill));
  }
}

/** Replaces the skills an agent may use; only skills of the agent's own department. */
@Injectable()
export class SetAgentSkillsUseCase {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    private readonly listAgentSkillsUseCase: ListAgentSkillsUseCase,
  ) {}

  setAgentSkills(agentId: string, skillIds: readonly string[]): DepartmentSkill[] {
    const departmentId = requireAgentDepartment(this.skillRepository, agentId);
    const uniqueIds = [...new Set(skillIds)];
    for (const skillId of uniqueIds) {
      const skill = this.skillRepository.findSkillById(skillId);
      if (skill === undefined || skill.departmentId !== departmentId) {
        throw new ValidationError('Chỉ gán được skill của phòng mà agent thuộc về.', {
          code: 'SKILL_NOT_IN_AGENT_DEPARTMENT',
        });
      }
    }
    this.skillRepository.replaceAgentSkills(agentId, uniqueIds);
    return this.listAgentSkillsUseCase.listAgentSkills(agentId);
  }
}

/**
 * Read by orchestration when an agent starts a turn: the skills it may use and where their files
 * are. An agent outside any department, or a skill whose files are gone, simply has none.
 */
@Injectable()
export class AgentSkillLibrary {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
  ) {}

  listAgentSkillFolders(agentId: string): AgentSkillFolder[] {
    const usedSlugs = new Set<string>();
    return this.skillRepository.listAgentSkills(agentId).map((skill) => {
      const base = toSkillSlug(skill.name);
      let slug = base;
      for (let attempt = 2; usedSlugs.has(slug); attempt += 1) slug = `${base}-${attempt}`;
      usedSlugs.add(slug);
      return {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        slug,
        folder: this.fileStore.locateSkillFolder(skill.id),
      };
    });
  }

  readSkillManifest(skillId: string): string {
    return this.fileStore.readSkillManifest(skillId);
  }
}
