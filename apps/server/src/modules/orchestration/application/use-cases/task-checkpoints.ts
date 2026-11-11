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
      if (checkpoint !== null) {
        this.checkpointRepository.insertCheckpoint({
          id: this.idGenerator.generateId(),
          taskId: task.id,
          sha: checkpoint.sha,
          message,
          files: checkpoint.files,
          stepId: task.currentStepId,
          agentId: task.assigneeAgentId,
        });
        this.eventLog.recordTaskEvent({
          taskId: task.id,
          agentId: task.assigneeAgentId,
          kind: 'checkpoint',
          payload: { sha: checkpoint.sha, fileCount: checkpoint.files.length, message },
        });
      }
    } catch (error) {
      this.logger.warn({ err: error, taskId: task.id }, 'task checkpoint could not be saved');
    }
    // After the checkpoint is recorded and isolated from it: the note must never cost a commit its row.
    await this.noteContentLeftOutSafely(task, worktreePath);
  }

  private async noteContentLeftOutSafely(task: Task, worktreePath: string): Promise<void> {
    try {
      await this.noteContentLeftOut(task, worktreePath);
    } catch (error) {
      this.logger.warn(
        { err: error, taskId: task.id },
        'could not list engine-managed content left out of the checkpoint',
      );
    }
  }

  /** Makes the omission visible: new files in engine-managed folders never enter a checkpoint. */
  private async noteContentLeftOut(task: Task, worktreePath: string): Promise<void> {
    const leftOut = await this.taskWorkspace.listUncommittedEngineManagedPaths(worktreePath);
    if (leftOut.total === 0) return;
    const shown = leftOut.paths.slice(0, 3).join(', ');
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: null,
      kind: 'message',
      payload: {
        platformNote: true,
        text:
          `Không lưu mốc ${leftOut.total} file trong thư mục cấu hình của engine ` +
          `(${shown}${leftOut.total > 3 ? '…' : ''}): nền tảng không đưa các thư mục ` +
          '.agents, .agent, _agents, _agent, .gemini mới vào kết quả của task.',
      },
    });
  }
}
