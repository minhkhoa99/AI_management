import { Inject, Injectable } from '@nestjs/common';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';
import { DIRECTORY_INSPECTOR, type DirectoryInspector } from '../ports/local-directories.port';
import { TASK_BOARD_QUERY, type TaskBoardQuery } from '../ports/task-board.query';

const RECENT_DIRECTORY_LIMIT = 5;

/** "Gần đây": folders of recent tasks that are still allowed. */
@Injectable()
export class ListRecentDirectoriesUseCase {
  constructor(
    @Inject(TASK_BOARD_QUERY) private readonly taskBoardQuery: TaskBoardQuery,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
    @Inject(DIRECTORY_INSPECTOR) private readonly directoryInspector: DirectoryInspector,
  ) {}

  listRecentDirectories(): string[] {
    const allowed = this.settingsRepository.listAllowedDirectories();
    return this.taskBoardQuery
      .listRecentWorkingDirectories(RECENT_DIRECTORY_LIMIT * 4)
      .filter((directoryPath) =>
        allowed.some((allowedPath) =>
          this.directoryInspector.isInsideDirectory(directoryPath, allowedPath),
        ),
      )
      .slice(0, RECENT_DIRECTORY_LIMIT);
  }
}
