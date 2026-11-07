import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  type DirectoryPick,
  type DirectoryValidation,
  type DirectoryValidationRequest,
  directoryValidationRequestSchema,
  type UpdateWorkspaceSettingsRequest,
  updateWorkspaceSettingsRequestSchema,
  type WorkspaceSettings,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { GetWorkspaceSettingsUseCase } from '../../application/use-cases/get-workspace-settings.use-case';
import { ListRecentDirectoriesUseCase } from '../../application/use-cases/list-recent-directories.use-case';
import { PickLocalDirectoryUseCase } from '../../application/use-cases/pick-local-directory.use-case';
import { UpdateWorkspaceSettingsUseCase } from '../../application/use-cases/update-workspace-settings.use-case';
import { ValidateWorkingDirectoryUseCase } from '../../application/use-cases/validate-working-directory.use-case';

@Controller('api')
export class WorkspaceController {
  constructor(
    private readonly getWorkspaceSettingsUseCase: GetWorkspaceSettingsUseCase,
    private readonly updateWorkspaceSettingsUseCase: UpdateWorkspaceSettingsUseCase,
    private readonly pickLocalDirectoryUseCase: PickLocalDirectoryUseCase,
    private readonly validateWorkingDirectoryUseCase: ValidateWorkingDirectoryUseCase,
    private readonly listRecentDirectoriesUseCase: ListRecentDirectoriesUseCase,
  ) {}

  @Get('settings')
  getWorkspaceSettings(): WorkspaceSettings {
    return this.getWorkspaceSettingsUseCase.getWorkspaceSettings();
  }

  @Patch('settings')
  updateWorkspaceSettings(
    @Body(new ZodRequestPipe(updateWorkspaceSettingsRequestSchema))
    request: UpdateWorkspaceSettingsRequest,
  ): WorkspaceSettings {
    return this.updateWorkspaceSettingsUseCase.updateWorkspaceSettings(request);
  }

  @Post('workspace/dir-picker')
  @HttpCode(200)
  pickLocalDirectory(): Promise<DirectoryPick> {
    return this.pickLocalDirectoryUseCase.pickLocalDirectory();
  }

  @Post('workspace/dir-validation')
  @HttpCode(200)
  validateWorkingDirectory(
    @Body(new ZodRequestPipe(directoryValidationRequestSchema)) request: DirectoryValidationRequest,
  ): Promise<DirectoryValidation> {
    return this.validateWorkingDirectoryUseCase.validateWorkingDirectory(request.path);
  }

  @Get('workspace/recent-dirs')
  listRecentDirectories(): string[] {
    return this.listRecentDirectoriesUseCase.listRecentDirectories();
  }
}
