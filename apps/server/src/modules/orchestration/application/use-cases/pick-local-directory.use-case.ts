import { Inject, Injectable } from '@nestjs/common';
import type { DirectoryPick } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';
import {
  DIRECTORY_PICKER,
  type DirectoryPicker,
} from '../../../../shared/runtime/directory-picker';
import { DIRECTORY_INSPECTOR, type DirectoryInspector } from '../ports/local-directories.port';

/**
 * Opens the system folder dialog on this machine. The folder the user picks becomes an allowed
 * working folder: choosing it in the dialog is the user's consent. One dialog at a time.
 */
@Injectable()
export class PickLocalDirectoryUseCase {
  private dialogOpen = false;

  constructor(
    @Inject(DIRECTORY_PICKER) private readonly directoryPicker: DirectoryPicker,
    @Inject(DIRECTORY_INSPECTOR) private readonly directoryInspector: DirectoryInspector,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
  ) {}

  async pickLocalDirectory(): Promise<DirectoryPick> {
    if (this.dialogOpen) {
      throw new ConflictError('Hộp chọn thư mục đang mở trên máy.', {
        code: 'DIRECTORY_PICKER_BUSY',
      });
    }
    this.dialogOpen = true;
    try {
      const pickedPath = await this.directoryPicker.pickDirectory();
      if (pickedPath === null) {
        return { path: null };
      }
      const facts = await this.directoryInspector.inspectDirectory(pickedPath);
      if (!facts.exists || !facts.isDirectory) {
        return { path: null };
      }
      const alreadyAllowed = this.settingsRepository
        .listAllowedDirectories()
        .includes(facts.absolutePath);
      if (!alreadyAllowed) {
        this.settingsRepository.addAllowedDirectory(facts.absolutePath);
      }
      return { path: facts.absolutePath };
    } finally {
      this.dialogOpen = false;
    }
  }
}
