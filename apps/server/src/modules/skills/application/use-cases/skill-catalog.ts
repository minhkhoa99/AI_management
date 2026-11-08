import { Inject, Injectable } from '@nestjs/common';
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type DepartmentSkill,
  type SkillSourceKind,
} from '@aiteam/contracts';
import { ConflictError, NotFoundError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  DEPARTMENT_SKILL_REPOSITORY,
  type DepartmentSkillRecord,
  type DepartmentSkillRepository,
} from '../../domain/repositories/department-skill.repository';
import { parseSkillManifest, SKILL_MANIFEST_FILE } from '../../domain/skill-manifest';
import {
  SKILL_FILE_STORE,
  type SkillFileContent,
  type SkillFileStore,
} from '../ports/skill-file-store.port';

/** Shared by the skill use cases: lookups, naming rules, saving a new skill and its files. */
@Injectable()
export class SkillCatalog {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  requireDepartment(departmentId: string): void {
    if (!this.skillRepository.departmentExists(departmentId)) {
      throw new NotFoundError('Không tìm thấy phòng ban.', { code: 'DEPARTMENT_NOT_FOUND' });
    }
  }

  requireSkill(skillId: string): DepartmentSkillRecord {
    const skill = this.skillRepository.findSkillById(skillId);
    if (skill === undefined) {
      throw new NotFoundError('Không tìm thấy skill.', { code: 'SKILL_NOT_FOUND' });
    }
    return skill;
  }

  /** A name the user typed: must be free in the department. */
  requireFreeName(departmentId: string, name: string, exceptSkillId: string | null): string {
    if (this.skillRepository.isSkillNameTaken(departmentId, name, exceptSkillId)) {
      throw new ConflictError(`Phòng đã có skill tên "${name}".`, { code: 'SKILL_NAME_TAKEN' });
    }
    return name;
  }

  /** A name that came with a file or template: suffixed " (2)", " (3)"… when already used. */
  pickFreeName(departmentId: string, wanted: string): string {
    const base = wanted.trim().slice(0, SKILL_NAME_MAX_LENGTH - 5) || 'Skill';
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? base : `${base} (${attempt})`;
      if (!this.skillRepository.isSkillNameTaken(departmentId, candidate, null)) return candidate;
    }
  }

  /**
   * Stores a new skill from its files (SKILL.md first). Name and description come from the
   * SKILL.md front matter unless given; `fallbackName` is used when it has neither.
   */
  createSkillFromFiles(input: {
    departmentId: string;
    files: readonly SkillFileContent[];
    sourceKind: SkillSourceKind;
    sourceUrl: string | null;
    fallbackName: string;
    name?: string;
  }): DepartmentSkill {
    const manifestFile = input.files.find((file) => file.path === SKILL_MANIFEST_FILE);
    const manifest = parseSkillManifest(manifestFile?.content.toString('utf8') ?? '');
    const skillId = this.idGenerator.generateId();
    const record = {
      id: skillId,
      departmentId: input.departmentId,
      name:
        input.name ?? this.pickFreeName(input.departmentId, manifest.name ?? input.fallbackName),
      description: (manifest.description ?? '').trim().slice(0, SKILL_DESCRIPTION_MAX_LENGTH),
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      fileCount: input.files.length,
      totalBytes: input.files.reduce((total, file) => total + file.content.length, 0),
    };
    this.fileStore.writeSkillFiles(skillId, input.files);
    try {
      this.skillRepository.insertSkill(record);
    } catch (error) {
      this.fileStore.removeSkillFiles(skillId);
      throw error;
    }
    return this.presentSkill(this.requireSkill(skillId));
  }

  /** Recounts files after SKILL.md changed. */
  refreshFileStats(skill: DepartmentSkillRecord): Omit<DepartmentSkillRecord, 'updatedAt'> {
    const files = this.fileStore.listSkillFiles(skill.id);
    return {
      ...skill,
      fileCount: Math.max(1, files.length),
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    };
  }

  presentSkill(skill: DepartmentSkillRecord): DepartmentSkill {
    return {
      ...skill,
      assignedAgentIds:
        this.skillRepository.listAssignedAgentIds(skill.departmentId).get(skill.id) ?? [],
    };
  }
}
