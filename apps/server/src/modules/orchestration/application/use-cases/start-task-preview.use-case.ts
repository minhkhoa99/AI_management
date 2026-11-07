import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { PreviewStatus, StartPreviewRequest } from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { TASK_WORKSPACE, type TaskWorkspace } from '../ports/task-execution.ports';
import { TaskPreviewRegistry } from './task-preview-registry';
import { TaskWorkspaceAccess } from './task-workspace-access';

/** "Giao diện": runs the task's preview command in its folder, or keeps it running. */
@Injectable()
export class StartTaskPreviewUseCase {
  constructor(
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    private readonly workspaceAccess: TaskWorkspaceAccess,
    private readonly previewRegistry: TaskPreviewRegistry,
  ) {}

  async startTaskPreview(taskId: string, request: StartPreviewRequest): Promise<PreviewStatus> {
    const { task, worktreePath } = this.workspaceAccess.requireTaskWorktree(taskId);
    const state = task.toState();
    if (state.previewCommand === null) {
      throw new ValidationError('Task chưa có lệnh chạy giao diện. Thêm lệnh ở "Sửa task".', {
        code: 'PREVIEW_NOT_CONFIGURED',
      });
    }
    const agentFolder = await this.taskWorkspace.locateAgentFolder(state.workingDirectory);
    return this.previewRegistry.startOrRenewPreview(taskId, {
      commandTemplate: state.previewCommand,
      directory: path.join(worktreePath, agentFolder),
      restart: request.restart,
    });
  }
}
