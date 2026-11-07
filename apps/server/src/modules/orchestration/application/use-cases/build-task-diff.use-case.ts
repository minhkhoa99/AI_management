import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceDiff } from '@aiteam/contracts';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';
import { parseUnifiedDiff } from '../../domain/unified-diff';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** Every change of the task since it started (base commit → latest checkpoint). */
@Injectable()
export class BuildTaskDiffUseCase {
  constructor(
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    private readonly workspaceAccess: TaskWorkspaceAccess,
  ) {}

  async buildTaskDiff(taskId: string): Promise<WorkspaceDiff> {
    const { task, worktreePath } = this.workspaceAccess.requireTaskWorktree(taskId);
    const latest = this.checkpointRepository.listCheckpoints(taskId)[0];
    if (latest === undefined) return { checkpointId: null, files: [] };
    const patch = await this.taskWorkspace.readRangePatch(
      worktreePath,
      task.toState().baseSha,
      latest.sha,
    );
    return { checkpointId: null, files: parseUnifiedDiff(patch) };
  }
}
