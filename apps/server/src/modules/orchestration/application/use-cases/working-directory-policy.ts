import { Inject, Injectable } from '@nestjs/common';
import type { DirectoryValidation } from '@aiteam/contracts';
import { PermissionDeniedError, ValidationError } from '../../../../shared/errors/app-error';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';
import { DIRECTORY_INSPECTOR, type DirectoryInspector } from '../ports/local-directories.port';

/**
 * A task works in a folder the user picked with the system dialog, or in a sub-folder of one.
 * Paths typed by hand (or sent by anyone else) are checked against that list after "~"
 * expansion and symlink resolution, so "..", links and junctions cannot escape it.
 */
@Injectable()
export class WorkingDirectoryPolicy {
  constructor(
    @Inject(DIRECTORY_INSPECTOR) private readonly directoryInspector: DirectoryInspector,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
  ) {}

  async describeWorkingDirectory(rawPath: string): Promise<DirectoryValidation> {
    const { validation } = await this.checkWorkingDirectory(rawPath);
    return validation;
  }

  /** Absolute path to store on the task; null when left empty (the platform makes a folder). */
  async requireUsableWorkingDirectory(rawPath: string): Promise<string | null> {
    if (rawPath.trim() === '') {
      return null;
    }
    const { validation, failure } = await this.checkWorkingDirectory(rawPath);
    if (failure !== null) {
      throw failure;
    }
    return validation.path;
  }

  private async checkWorkingDirectory(
    rawPath: string,
  ): Promise<{ validation: DirectoryValidation; failure: Error | null }> {
    const facts = await this.directoryInspector.inspectDirectory(rawPath);
    const allowed = this.isAllowed(facts.absolutePath);
    let failure: Error | null = null;
    if (!facts.exists) {
      failure = new ValidationError('Không tìm thấy thư mục này trên máy.', {
        code: 'WORKING_DIRECTORY_NOT_FOUND',
      });
    } else if (!facts.isDirectory) {
      failure = new ValidationError('Đường dẫn này là file, không phải thư mục.', {
        code: 'WORKING_DIRECTORY_NOT_A_FOLDER',
      });
    } else if (!allowed) {
      failure = new PermissionDeniedError(
        'Thư mục chưa được cho phép. Bấm "Chọn thư mục" để chọn nó (hoặc thư mục cha) từ máy.',
        { code: 'WORKING_DIRECTORY_NOT_ALLOWED' },
      );
    }
    return {
      validation: {
        path: facts.absolutePath,
        exists: facts.exists,
        allowed,
        isGitRepository: facts.isGitRepository,
        problem: failure?.message ?? null,
      },
      failure,
    };
  }

  private isAllowed(absolutePath: string): boolean {
    return this.settingsRepository
      .listAllowedDirectories()
      .some((allowedPath) => this.directoryInspector.isInsideDirectory(absolutePath, allowedPath));
  }
}
