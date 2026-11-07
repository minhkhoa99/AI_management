import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceDiff } from '@aiteam/contracts';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
} from '../../domain/repositories/checkpoint.repository';
import { parseUnifiedDiff } from '../../domain/unified-diff';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { requireCheckpoint } from './checkpoint-lookup';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** What one checkpoint changed. */
@Injectable()
export class BuildCheckpointDiffUseCase {
  constructor(
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    private readonly workspaceAccess: TaskWorkspaceAccess,
  ) {}

  async buildCheckpointDiff(checkpointId: string): Promise<WorkspaceDiff> {
    const checkpoint = requireCheckpoint(this.checkpointRepository, checkpointId);
    const { worktreePath } = this.workspaceAccess.requireTaskWorktree(checkpoint.taskId);
    const patch = await this.taskWorkspace.readCommitPatch(worktreePath, checkpoint.sha);
    return { checkpointId, files: parseUnifiedDiff(patch) };
  }
}
