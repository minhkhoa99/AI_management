import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceFileContent } from '@aiteam/contracts';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** One file of the worktree (512 KB at most, binary files without content). */
@Injectable()
export class ReadWorkspaceFileUseCase {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    private readonly workspaceAccess: TaskWorkspaceAccess,
  ) {}

  readWorkspaceFile(taskId: string, filePath: string): Promise<WorkspaceFileContent> {
    const { worktreePath } = this.workspaceAccess.requireTaskWorktree(taskId);
    return this.taskWorkspace.readWorkspaceFile(worktreePath, filePath);
  }
}
