import { Inject, Injectable } from '@nestjs/common';
import type {
  AddTemplateSkillRequest,
  CreateWrittenSkillRequest,
  DepartmentSkill,
} from '@aiteam/contracts';
import { NotFoundError, ValidationError } from '../../../../shared/errors/app-error';
import { buildSkillManifest, SKILL_MANIFEST_FILE } from '../../domain/skill-manifest';
import { SKILL_TEMPLATES } from '../../domain/skill-templates';
import {
  GITHUB_SKILL_DOWNLOADER,
  SKILL_ARCHIVE_READER,
  type GithubSkillDownloader,
  type SkillArchiveReader,
} from '../ports/skill-sources.ports';
import { SkillCatalog } from './skill-catalog';

function manifestFile(name: string, description: string, body: string) {
  return {
    path: SKILL_MANIFEST_FILE,
    content: Buffer.from(buildSkillManifest({ name, description, body }), 'utf8'),
  };
}

/** "Viết skill": name, description and instructions typed in the app. */
@Injectable()
export class CreateWrittenSkillUseCase {
  constructor(private readonly skillCatalog: SkillCatalog) {}

  createWrittenSkill(departmentId: string, request: CreateWrittenSkillRequest): DepartmentSkill {
    this.skillCatalog.requireDepartment(departmentId);
    const name = this.skillCatalog.requireFreeName(departmentId, request.name, null);
    return this.skillCatalog.createSkillFromFiles({
      departmentId,
      files: [manifestFile(name, request.description, request.content)],
      sourceKind: 'written',
      sourceUrl: null,
      fallbackName: name,
      name,
    });
  }
}

/** "Thêm từ mẫu": a copy of a built-in template the department can then edit. */
@Injectable()
export class AddTemplateSkillUseCase {
  constructor(private readonly skillCatalog: SkillCatalog) {}

  addTemplateSkill(departmentId: string, request: AddTemplateSkillRequest): DepartmentSkill {
    this.skillCatalog.requireDepartment(departmentId);
    const template = SKILL_TEMPLATES.find((candidate) => candidate.id === request.templateId);
    if (template === undefined) {
      throw new NotFoundError('Không có skill mẫu này.', { code: 'SKILL_TEMPLATE_NOT_FOUND' });
    }
    const name = this.skillCatalog.pickFreeName(departmentId, template.name);
    return this.skillCatalog.createSkillFromFiles({
      departmentId,
      files: [manifestFile(name, template.description, template.body)],
      sourceKind: 'template',
      sourceUrl: null,
      fallbackName: name,
      name,
    });
  }
}

/** "Tải lên": a SKILL.md (or any .md) file, or a .zip holding one skill folder. */
@Injectable()
export class UploadSkillFileUseCase {
  constructor(
    @Inject(SKILL_ARCHIVE_READER) private readonly archiveReader: SkillArchiveReader,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  uploadSkillFile(departmentId: string, fileName: string, content: Buffer): DepartmentSkill {
    this.skillCatalog.requireDepartment(departmentId);
    if (content.length === 0) {
      throw new ValidationError('File trống.', { code: 'SKILL_FILE_EMPTY' });
    }
    const baseName = fileName.replace(/\.(md|zip)$/i, '');
    const isArchive = /\.zip$/i.test(fileName);
    return this.skillCatalog.createSkillFromFiles({
      departmentId,
      files: isArchive
        ? this.archiveReader.extractSkillFiles(content, { folder: null, stripTopFolder: false })
        : [{ path: SKILL_MANIFEST_FILE, content }],
      sourceKind: isArchive ? 'zip' : 'markdown',
      sourceUrl: null,
      fallbackName: baseName.toLowerCase() === 'skill' ? 'Skill' : baseName,
    });
  }
}

/** "Từ GitHub": a public repository folder or .md file. */
@Injectable()
export class ImportGithubSkillUseCase {
  constructor(
    @Inject(GITHUB_SKILL_DOWNLOADER) private readonly downloader: GithubSkillDownloader,
    @Inject(SKILL_ARCHIVE_READER) private readonly archiveReader: SkillArchiveReader,
    private readonly skillCatalog: SkillCatalog,
  ) {}

  async importGithubSkill(departmentId: string, url: string): Promise<DepartmentSkill> {
    this.skillCatalog.requireDepartment(departmentId);
    const source = await this.downloader.downloadGithubSkill(url);
    const files =
      source.kind === 'markdown'
        ? [{ path: SKILL_MANIFEST_FILE, content: Buffer.from(source.text, 'utf8') }]
        : this.archiveReader.extractSkillFiles(source.archive, source.selection);
    const lastSegment = url.replace(/\/+$/, '').split('/').at(-1) ?? 'skill';
    return this.skillCatalog.createSkillFromFiles({
      departmentId,
      files,
      sourceKind: 'github',
      sourceUrl: url.trim(),
      fallbackName: lastSegment.replace(/\.md$/i, ''),
    });
  }
}
