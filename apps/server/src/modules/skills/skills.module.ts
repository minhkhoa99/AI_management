import { Module } from '@nestjs/common';
import {
  AgentSkillLibrary,
  ListAgentSkillsUseCase,
  SetAgentSkillsUseCase,
} from './application/use-cases/agent-skill.use-cases';
import {
  AddTemplateSkillUseCase,
  CreateWrittenSkillUseCase,
  ImportGithubSkillUseCase,
  UploadSkillFileUseCase,
} from './application/use-cases/create-skill.use-cases';
import {
  CopySkillUseCase,
  DeleteSkillUseCase,
  GetSkillDetailUseCase,
  ListDepartmentSkillsUseCase,
  ListSkillTemplatesUseCase,
  UpdateSkillUseCase,
} from './application/use-cases/manage-skill.use-cases';
import { SkillCatalog } from './application/use-cases/skill-catalog';
import { SKILL_FILE_STORE } from './application/ports/skill-file-store.port';
import {
  GITHUB_SKILL_DOWNLOADER,
  SKILL_ARCHIVE_READER,
} from './application/ports/skill-sources.ports';
import { DEPARTMENT_SKILL_REPOSITORY } from './domain/repositories/department-skill.repository';
import { FsSkillFileStore } from './infrastructure/adapters/fs-skill-file-store';
import { FetchGithubSkillDownloader } from './infrastructure/adapters/github-skill-downloader';
import { ZipSkillArchiveReader } from './infrastructure/adapters/zip-skill-archive-reader';
import { SqliteDepartmentSkillRepository } from './infrastructure/persistence/sqlite-department-skill.repository';
import { SkillsController } from './presentation/controllers/skills.controller';

/** Department skills: written, templated, uploaded or imported from GitHub; assigned to agents. */
@Module({
  controllers: [SkillsController],
  providers: [
    { provide: DEPARTMENT_SKILL_REPOSITORY, useClass: SqliteDepartmentSkillRepository },
    { provide: SKILL_FILE_STORE, useClass: FsSkillFileStore },
    { provide: SKILL_ARCHIVE_READER, useClass: ZipSkillArchiveReader },
    { provide: GITHUB_SKILL_DOWNLOADER, useClass: FetchGithubSkillDownloader },
    SkillCatalog,
    ListDepartmentSkillsUseCase,
    GetSkillDetailUseCase,
    ListSkillTemplatesUseCase,
    CreateWrittenSkillUseCase,
    AddTemplateSkillUseCase,
    UploadSkillFileUseCase,
    ImportGithubSkillUseCase,
    UpdateSkillUseCase,
    DeleteSkillUseCase,
    CopySkillUseCase,
    ListAgentSkillsUseCase,
    SetAgentSkillsUseCase,
    AgentSkillLibrary,
  ],
  exports: [AgentSkillLibrary],
})
export class SkillsModule {}
