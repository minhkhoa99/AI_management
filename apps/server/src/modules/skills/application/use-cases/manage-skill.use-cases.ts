import { Inject, Injectable } from '@nestjs/common';
import type {
  DepartmentSkill,
  SkillDetail,
  SkillTemplate,
  UpdateSkillRequest,
} from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import {
  DEPARTMENT_SKILL_REPOSITORY,
  type DepartmentSkillRepository,
} from '../../domain/repositories/department-skill.repository';
import { buildSkillManifest, parseSkillManifest } from '../../domain/skill-manifest';
import { SKILL_TEMPLATES } from '../../domain/skill-templates';
import { SKILL_FILE_STORE, type SkillFileStore } from '../ports/skill-file-store.port';
import { SkillCatalog } from './skill-catalog';

@Injectable()
export class ListDepartmentSkillsUseCase {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  listDepartmentSkills(departmentId: string): DepartmentSkill[] {
    this.skillCatalog.requireDepartment(departmentId);
    const assignments = this.skillRepository.listAssignedAgentIds(departmentId);
    return this.skillRepository
      .listDepartmentSkills(departmentId)
      .map((skill) => ({ ...skill, assignedAgentIds: assignments.get(skill.id) ?? [] }));
  }
}

@Injectable()
export class GetSkillDetailUseCase {
  constructor(
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  getSkillDetail(skillId: string): SkillDetail {
    const skill = this.skillCatalog.requireSkill(skillId);
    return {
      ...this.skillCatalog.presentSkill(skill),
      content: parseSkillManifest(this.fileStore.readSkillManifest(skillId)).body,
      files: this.fileStore.listSkillFiles(skillId),
    };
  }
}

@Injectable()
export class ListSkillTemplatesUseCase {
  listSkillTemplates(): SkillTemplate[] {
    return SKILL_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
  }
}

/** Renames or edits a skill: SKILL.md is rewritten with the new name, description and text. */
@Injectable()
export class UpdateSkillUseCase {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
    private readonly skillCatalog: SkillCatalog,
    private readonly getSkillDetailUseCase: GetSkillDetailUseCase,
  ) {}

  updateSkill(skillId: string, request: UpdateSkillRequest): SkillDetail {
    const skill = this.skillCatalog.requireSkill(skillId);
    const name =
      request.name === undefined
        ? skill.name
        : this.skillCatalog.requireFreeName(skill.departmentId, request.name, skillId);
    const description = request.description ?? skill.description;
    const body =
      request.content ?? parseSkillManifest(this.fileStore.readSkillManifest(skillId)).body;
    this.fileStore.writeSkillManifest(skillId, buildSkillManifest({ name, description, body }));
    this.skillRepository.updateSkill(
      this.skillCatalog.refreshFileStats({ ...skill, name, description }),
    );
    return this.getSkillDetailUseCase.getSkillDetail(skillId);
  }
}

/** Deletes the skill, its files, and takes it away from every agent. */
@Injectable()
export class DeleteSkillUseCase {
  constructor(
    @Inject(DEPARTMENT_SKILL_REPOSITORY)
    private readonly skillRepository: DepartmentSkillRepository,
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  deleteSkill(skillId: string): void {
    this.skillCatalog.requireSkill(skillId);
    this.skillRepository.deleteSkill(skillId);
    this.fileStore.removeSkillFiles(skillId);
  }
}

/** "Sao chép sang phòng khác": an independent copy (files included), assigned to nobody. */
@Injectable()
export class CopySkillUseCase {
  constructor(
    @Inject(SKILL_FILE_STORE) private readonly fileStore: SkillFileStore,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  copySkillToDepartment(skillId: string, targetDepartmentId: string): DepartmentSkill {
    const skill = this.skillCatalog.requireSkill(skillId);
    this.skillCatalog.requireDepartment(targetDepartmentId);
    if (targetDepartmentId === skill.departmentId) {
      throw new ValidationError('Chọn một phòng khác để sao chép.', { code: 'SKILL_COPY_SAME' });
    }
    const files = this.fileStore.listSkillFiles(skillId);
    return this.skillCatalog.createSkillFromFiles({
      departmentId: targetDepartmentId,
      files: files.map((file) => ({
        path: file.path,
        content: this.fileStore.readSkillFile(skillId, file.path),
      })),
      sourceKind: skill.sourceKind,
      sourceUrl: skill.sourceUrl,
      fallbackName: skill.name,
      name: this.skillCatalog.pickFreeName(targetDepartmentId, skill.name),
    });
  }
}
