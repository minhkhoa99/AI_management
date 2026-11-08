import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  addTemplateSkillRequestSchema,
  copySkillRequestSchema,
  createWrittenSkillRequestSchema,
  entityIdSchema,
  importGithubSkillRequestSchema,
  setAgentSkillsRequestSchema,
  skillUploadFileNameSchema,
  updateSkillRequestSchema,
  type AddTemplateSkillRequest,
  type CopySkillRequest,
  type CreateWrittenSkillRequest,
  type DepartmentSkill,
  type ImportGithubSkillRequest,
  type SetAgentSkillsRequest,
  type SkillDetail,
  type SkillTemplate,
  type UpdateSkillRequest,
} from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import {
  ListAgentSkillsUseCase,
  SetAgentSkillsUseCase,
} from '../../application/use-cases/agent-skill.use-cases';
import {
  AddTemplateSkillUseCase,
  CreateWrittenSkillUseCase,
  ImportGithubSkillUseCase,
  UploadSkillFileUseCase,
} from '../../application/use-cases/create-skill.use-cases';
import {
  CopySkillUseCase,
  DeleteSkillUseCase,
  GetSkillDetailUseCase,
  ListDepartmentSkillsUseCase,
  ListSkillTemplatesUseCase,
  UpdateSkillUseCase,
} from '../../application/use-cases/manage-skill.use-cases';

const departmentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã phòng ban');
const skillIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã skill');
const agentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã agent');

@Controller('api')
export class SkillsController {
  constructor(
    private readonly listDepartmentSkillsUseCase: ListDepartmentSkillsUseCase,
    private readonly getSkillDetailUseCase: GetSkillDetailUseCase,
    private readonly listSkillTemplatesUseCase: ListSkillTemplatesUseCase,
    private readonly createWrittenSkillUseCase: CreateWrittenSkillUseCase,
    private readonly addTemplateSkillUseCase: AddTemplateSkillUseCase,
    private readonly uploadSkillFileUseCase: UploadSkillFileUseCase,
    private readonly importGithubSkillUseCase: ImportGithubSkillUseCase,
    private readonly updateSkillUseCase: UpdateSkillUseCase,
    private readonly deleteSkillUseCase: DeleteSkillUseCase,
    private readonly copySkillUseCase: CopySkillUseCase,
    private readonly listAgentSkillsUseCase: ListAgentSkillsUseCase,
    private readonly setAgentSkillsUseCase: SetAgentSkillsUseCase,
  ) {}

  @Get('departments/:departmentId/skills')
  listDepartmentSkills(
    @Param('departmentId', departmentIdPipe) departmentId: string,
  ): DepartmentSkill[] {
    return this.listDepartmentSkillsUseCase.listDepartmentSkills(departmentId);
  }

  @Post('departments/:departmentId/skills')
  createWrittenSkill(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(createWrittenSkillRequestSchema)) request: CreateWrittenSkillRequest,
  ): DepartmentSkill {
    return this.createWrittenSkillUseCase.createWrittenSkill(departmentId, request);
  }

  @Post('departments/:departmentId/skills/from-template')
  addTemplateSkill(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(addTemplateSkillRequestSchema)) request: AddTemplateSkillRequest,
  ): DepartmentSkill {
    return this.addTemplateSkillUseCase.addTemplateSkill(departmentId, request);
  }

  @Post('departments/:departmentId/skills/from-github')
  importGithubSkill(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(importGithubSkillRequestSchema)) request: ImportGithubSkillRequest,
  ): Promise<DepartmentSkill> {
    return this.importGithubSkillUseCase.importGithubSkill(departmentId, request.url);
  }

  /** Raw file bytes (application/octet-stream): a .md or a .zip holding one skill. */
  @Put('departments/:departmentId/skills/upload')
  uploadSkillFile(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Query('fileName', new ZodRequestPipe(skillUploadFileNameSchema, 'Tên file')) fileName: string,
    @Body() content: unknown,
  ): DepartmentSkill {
    if (!Buffer.isBuffer(content)) {
      throw new ValidationError('Gửi nội dung file dạng application/octet-stream.', {
        code: 'SKILL_UPLOAD_BODY_INVALID',
      });
    }
    return this.uploadSkillFileUseCase.uploadSkillFile(departmentId, fileName, content);
  }

  @Get('skills/templates')
  listSkillTemplates(): SkillTemplate[] {
    return this.listSkillTemplatesUseCase.listSkillTemplates();
  }

  @Get('skills/:skillId')
  getSkillDetail(@Param('skillId', skillIdPipe) skillId: string): SkillDetail {
    return this.getSkillDetailUseCase.getSkillDetail(skillId);
  }

  @Patch('skills/:skillId')
  updateSkill(
    @Param('skillId', skillIdPipe) skillId: string,
    @Body(new ZodRequestPipe(updateSkillRequestSchema)) request: UpdateSkillRequest,
  ): SkillDetail {
    return this.updateSkillUseCase.updateSkill(skillId, request);
  }

  @Delete('skills/:skillId')
  @HttpCode(204)
  deleteSkill(@Param('skillId', skillIdPipe) skillId: string): void {
    this.deleteSkillUseCase.deleteSkill(skillId);
  }

  @Post('skills/:skillId/copy')
  copySkill(
    @Param('skillId', skillIdPipe) skillId: string,
    @Body(new ZodRequestPipe(copySkillRequestSchema)) request: CopySkillRequest,
  ): DepartmentSkill {
    return this.copySkillUseCase.copySkillToDepartment(skillId, request.targetDepartmentId);
  }

  @Get('agents/:agentId/skills')
  listAgentSkills(@Param('agentId', agentIdPipe) agentId: string): DepartmentSkill[] {
    return this.listAgentSkillsUseCase.listAgentSkills(agentId);
  }

  @Put('agents/:agentId/skills')
  setAgentSkills(
    @Param('agentId', agentIdPipe) agentId: string,
    @Body(new ZodRequestPipe(setAgentSkillsRequestSchema)) request: SetAgentSkillsRequest,
  ): DepartmentSkill[] {
    return this.setAgentSkillsUseCase.setAgentSkills(agentId, request.skillIds);
  }
}
