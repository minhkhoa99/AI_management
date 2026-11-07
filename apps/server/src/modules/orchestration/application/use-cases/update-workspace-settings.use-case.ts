import { Inject, Injectable } from '@nestjs/common';
import type { UpdateWorkspaceSettingsRequest, WorkspaceSettings } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ValidationError } from '../../../../shared/errors/app-error';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';
import { GetWorkspaceSettingsUseCase } from './get-workspace-settings.use-case';

/**
 * Removes allowed folders and changes how many agents run at once. Adding a folder is only
 * possible through the system folder dialog (PickLocalDirectoryUseCase).
 */
@Injectable()
export class UpdateWorkspaceSettingsUseCase {
  constructor(
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly getWorkspaceSettingsUseCase: GetWorkspaceSettingsUseCase,
  ) {}

  updateWorkspaceSettings(request: UpdateWorkspaceSettingsRequest): WorkspaceSettings {
    this.transactionRunner.runInTransaction(() => {
      if (request.allowedDirectories !== undefined) {
        const current = this.settingsRepository.listAllowedDirectories();
        const kept = new Set(request.allowedDirectories);
        if ([...kept].some((directoryPath) => !current.includes(directoryPath))) {
          throw new ValidationError(
            'Chỉ thêm được thư mục bằng nút "Thêm thư mục" (hộp chọn thư mục của máy).',
            { code: 'ALLOWED_DIRECTORY_NOT_PICKED' },
          );
        }
        for (const directoryPath of current) {
          if (!kept.has(directoryPath)) {
            this.settingsRepository.removeAllowedDirectory(directoryPath);
          }
        }
      }
      if (request.maxParallelAgents !== undefined) {
        this.settingsRepository.saveMaxParallelAgents(request.maxParallelAgents);
      }
    });
    return this.getWorkspaceSettingsUseCase.getWorkspaceSettings();
  }
}
