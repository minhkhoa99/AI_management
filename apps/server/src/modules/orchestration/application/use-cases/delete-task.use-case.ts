import { Inject, Injectable } from '@nestjs/common';
import type { TaskDeletion } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { QA_DOCUMENT_STORE, type QaDocumentStore } from '../ports/qa-document-store.port';
import { requireTaskExists } from './get-task-detail.use-case';

/**
 * Deletes a task that no agent is working on (queued or finished), with its QA documents.
 * Tasks with a live agent session are cancelled first (execution, phase 3 part C).
 */
@Injectable()
export class DeleteTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(QA_DOCUMENT_STORE) private readonly documentStore: QaDocumentStore,
  ) {}

  deleteTask(taskId: string): TaskDeletion {
    const task = requireTaskExists(this.taskRepository, taskId);
    if (task.status !== 'queued' && !task.isFinished) {
      throw new ConflictError('Task đang được agent thực hiện, chưa xoá được.', {
        code: 'TASK_IN_PROGRESS',
      });
    }
    this.taskRepository.deleteTask(taskId);
    this.documentStore.removeTaskDocuments(taskId);
    return { taskId, outcome: 'deleted' };
  }
}
