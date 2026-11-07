import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceSettings } from '@aiteam/contracts';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';

@Injectable()
export class GetWorkspaceSettingsUseCase {
  constructor(
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
  ) {}

  getWorkspaceSettings(): WorkspaceSettings {
    return {
      allowedDirectories: this.settingsRepository.listAllowedDirectories(),
      maxParallelAgents: this.settingsRepository.readMaxParallelAgents(),
    };
  }
}
