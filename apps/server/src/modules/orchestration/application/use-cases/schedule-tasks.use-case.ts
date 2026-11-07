import { Inject, Injectable } from '@nestjs/common';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  type WorkspaceSettingsRepository,
} from '../../domain/repositories/workspace-settings.repository';
import { StartTaskTurnUseCase } from './start-task-turn.use-case';
import { TaskRunRegistry } from './task-run-registry';

/**
 * Starts queued tasks while parallel slots are free (Settings: "Số agent chạy cùng lúc").
 * Highest priority first, then the oldest. One pass at a time.
 */
@Injectable()
export class ScheduleTasksUseCase {
  private passInProgress = false;

  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(WORKSPACE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: WorkspaceSettingsRepository,
    private readonly runRegistry: TaskRunRegistry,
    private readonly startTaskTurnUseCase: StartTaskTurnUseCase,
  ) {}

  /** Never rejects (each start fails only its own task). */
  async scheduleQueuedTasks(): Promise<void> {
    if (this.passInProgress) return;
    this.passInProgress = true;
    try {
      const candidates = this.taskRepository.listRunnableTaskIds(new Date().toISOString());
      for (const taskId of candidates) {
        if (this.runRegistry.countActiveRuns() >= this.settingsRepository.readMaxParallelAgents()) {
          return;
        }
        await this.startTaskTurnUseCase.startTaskTurn(taskId);
      }
    } finally {
      this.passInProgress = false;
    }
  }
}
