import { Inject, Injectable } from '@nestjs/common';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import type { Task } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { QA_DOCUMENT_STORE, type QaDocumentStore } from '../ports/qa-document-store.port';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { TaskPreviewRegistry } from './task-preview-registry';

/**
 * Deletes a task nobody works on any more: commits what the agent left ("lưu mốc" on the kept
 * agent/<taskId> branch), removes the worktree, the QA documents and the task itself.
 */
@Injectable()
export class TaskRemoval {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(QA_DOCUMENT_STORE) private readonly documentStore: QaDocumentStore,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly previewRegistry: TaskPreviewRegistry,
  ) {}

  /** Never rejects: a git problem is logged, the task is deleted anyway. */
  async removeTask(task: Task): Promise<void> {
    const worktreePath = task.toState().worktreePath;
    // A dev server running in the worktree would keep its files locked (Windows).
    await this.previewRegistry.stopPreviewAndWait(task.id);
    if (worktreePath !== null) {
      try {
        await this.taskWorkspace.saveCheckpoint(worktreePath, `aiteam: lưu mốc trước khi xoá task`);
        await this.taskWorkspace.removeTaskWorkspace(worktreePath);
      } catch (error) {
        this.logger.warn({ err: error, taskId: task.id }, 'task worktree could not be cleaned up');
      }
    }
    this.taskRepository.deleteTask(task.id);
    try {
      this.documentStore.removeTaskDocuments(task.id);
    } catch (error) {
      this.logger.warn({ err: error, taskId: task.id }, 'task QA documents could not be removed');
    }
  }
}
