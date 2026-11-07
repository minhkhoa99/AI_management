import { Inject, Injectable } from '@nestjs/common';
import type { Checkpoint } from '@aiteam/contracts';
import {
  TASK_EVENT_LOG,
  TASK_WORKSPACE,
  type TaskEventLog,
  type TaskWorkspace,
} from '../ports/task-execution.ports';
import { ListCheckpointsUseCase } from './list-checkpoints.use-case';
import { TaskCheckpoints } from './task-checkpoints';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** "Hoàn tác file": back to how it was when the task started, saved as a new checkpoint. */
@Injectable()
export class RevertWorkspaceFileUseCase {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    private readonly workspaceAccess: TaskWorkspaceAccess,
    private readonly checkpoints: TaskCheckpoints,
    private readonly listCheckpointsUseCase: ListCheckpointsUseCase,
  ) {}

  async revertWorkspaceFile(taskId: string, filePath: string): Promise<Checkpoint[]> {
    const { task, worktreePath } = this.workspaceAccess.requireIdleTaskWorktree(taskId);
    await this.taskWorkspace.revertWorkspaceFile(worktreePath, task.toState().baseSha, filePath);
    await this.checkpoints.saveTaskCheckpoint(task, `aiteam: hoàn tác ${filePath}`);
    this.eventLog.recordTaskEvent({
      taskId,
      agentId: null,
      kind: 'file_reverted',
      payload: { path: filePath },
    });
    return this.listCheckpointsUseCase.listCheckpoints(taskId);
  }
}
