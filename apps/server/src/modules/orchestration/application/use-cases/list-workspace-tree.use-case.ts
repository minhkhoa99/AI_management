import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceTree } from '@aiteam/contracts';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** "Code & thư mục": files of the task worktree (.gitignore respected, .git never listed). */
@Injectable()
export class ListWorkspaceTreeUseCase {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    private readonly workspaceAccess: TaskWorkspaceAccess,
  ) {}

  async listWorkspaceTree(taskId: string): Promise<WorkspaceTree> {
    const { task, worktreePath } = this.workspaceAccess.requireTaskWorktree(taskId);
    const [files, agentFolder] = await Promise.all([
      this.taskWorkspace.listWorkspaceFiles(worktreePath),
      this.taskWorkspace.locateAgentFolder(task.toState().workingDirectory),
    ]);
    return { files, agentFolder };
  }
}
