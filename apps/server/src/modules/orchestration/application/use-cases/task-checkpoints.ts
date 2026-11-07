import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import type { Task } from '../../domain/entities/task';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';
import {
  TASK_EVENT_LOG,
  TASK_WORKSPACE,
  type TaskEventLog,
  type TaskWorkspace,
} from '../ports/task-execution.ports';

/** "Mốc": a commit on the task branch after each turn, so work is never lost. */
@Injectable()
export class TaskCheckpoints {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Never rejects: a failed commit is logged and the workflow goes on. */
  async saveTaskCheckpoint(task: Task, message: string): Promise<void> {
    const worktreePath = task.toState().worktreePath;
    if (worktreePath === null) return;
    try {
      const checkpoint = await this.taskWorkspace.saveCheckpoint(worktreePath, message);
      if (checkpoint === null) return;
      this.checkpointRepository.insertCheckpoint({
        id: this.idGenerator.generateId(),
        taskId: task.id,
        sha: checkpoint.sha,
        message,
        files: checkpoint.files,
      });
      this.eventLog.recordTaskEvent({
        taskId: task.id,
        agentId: task.assigneeAgentId,
        kind: 'checkpoint',
        payload: { sha: checkpoint.sha, fileCount: checkpoint.files.length, message },
      });
    } catch (error) {
      this.logger.warn({ err: error, taskId: task.id }, 'task checkpoint could not be saved');
    }
  }
}
