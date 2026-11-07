import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type AddLineCommentRequest,
  addLineCommentRequestSchema,
  type AgentTile,
  type Checkpoint,
  entityIdSchema,
  type LineComment,
  type RevertWorkspaceFileRequest,
  revertWorkspaceFileRequestSchema,
  type SubmitCodeReviewRequest,
  submitCodeReviewRequestSchema,
  type TaskDetail,
  type TaskSummary,
  type WorkspaceDiff,
  type WorkspaceFileContent,
  workspacePathSchema,
  type WorkspaceTree,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { AddLineCommentUseCase } from '../../application/use-cases/add-line-comment.use-case';
import { BuildCheckpointDiffUseCase } from '../../application/use-cases/build-checkpoint-diff.use-case';
import { BuildTaskDiffUseCase } from '../../application/use-cases/build-task-diff.use-case';
import { ListAgentTilesUseCase } from '../../application/use-cases/list-agent-tiles.use-case';
import { ListCheckpointsUseCase } from '../../application/use-cases/list-checkpoints.use-case';
import { ListDelegatedTasksUseCase } from '../../application/use-cases/list-delegated-tasks.use-case';
import { ListLineCommentsUseCase } from '../../application/use-cases/list-line-comments.use-case';
import { ListWorkspaceTreeUseCase } from '../../application/use-cases/list-workspace-tree.use-case';
import { PauseTaskUseCase } from '../../application/use-cases/pause-task.use-case';
import { ReadWorkspaceFileUseCase } from '../../application/use-cases/read-workspace-file.use-case';
import { ResumeTaskUseCase } from '../../application/use-cases/resume-task.use-case';
import { RevertWorkspaceFileUseCase } from '../../application/use-cases/revert-workspace-file.use-case';
import { SubmitCodeReviewUseCase } from '../../application/use-cases/submit-code-review.use-case';

const taskIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã task');
const checkpointIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã mốc');

/** Live monitor: agent tiles and everything about one task's worktree and its review. */
@Controller('api')
export class MonitorController {
  constructor(
    private readonly listAgentTilesUseCase: ListAgentTilesUseCase,
    private readonly listDelegatedTasksUseCase: ListDelegatedTasksUseCase,
    private readonly listWorkspaceTreeUseCase: ListWorkspaceTreeUseCase,
    private readonly readWorkspaceFileUseCase: ReadWorkspaceFileUseCase,
    private readonly listCheckpointsUseCase: ListCheckpointsUseCase,
    private readonly buildCheckpointDiffUseCase: BuildCheckpointDiffUseCase,
    private readonly buildTaskDiffUseCase: BuildTaskDiffUseCase,
    private readonly listLineCommentsUseCase: ListLineCommentsUseCase,
    private readonly addLineCommentUseCase: AddLineCommentUseCase,
    private readonly submitCodeReviewUseCase: SubmitCodeReviewUseCase,
    private readonly revertWorkspaceFileUseCase: RevertWorkspaceFileUseCase,
    private readonly pauseTaskUseCase: PauseTaskUseCase,
    private readonly resumeTaskUseCase: ResumeTaskUseCase,
  ) {}

  @Get('monitor/agents')
  listAgentTiles(
    @Query('departmentId', new ZodRequestPipe(entityIdSchema.optional(), 'Mã phòng ban'))
    departmentId: string | undefined,
  ): AgentTile[] {
    return this.listAgentTilesUseCase.listAgentTiles(departmentId);
  }

  @Get('agents/:agentId/delegated-tasks')
  listDelegatedTasks(
    @Param('agentId', new ZodRequestPipe(entityIdSchema, 'Mã agent')) agentId: string,
  ): TaskSummary[] {
    return this.listDelegatedTasksUseCase.listDelegatedTasks(agentId);
  }

  @Get('tasks/:taskId/workspace/tree')
  listWorkspaceTree(@Param('taskId', taskIdPipe) taskId: string): Promise<WorkspaceTree> {
    return this.listWorkspaceTreeUseCase.listWorkspaceTree(taskId);
  }

  @Get('tasks/:taskId/workspace/file')
  readWorkspaceFile(
    @Param('taskId', taskIdPipe) taskId: string,
    @Query('path', new ZodRequestPipe(workspacePathSchema, 'Đường dẫn')) filePath: string,
  ): Promise<WorkspaceFileContent> {
    return this.readWorkspaceFileUseCase.readWorkspaceFile(taskId, filePath);
  }

  @Get('tasks/:taskId/checkpoints')
  listCheckpoints(@Param('taskId', taskIdPipe) taskId: string): Checkpoint[] {
    return this.listCheckpointsUseCase.listCheckpoints(taskId);
  }

  @Get('tasks/:taskId/diff')
  buildTaskDiff(@Param('taskId', taskIdPipe) taskId: string): Promise<WorkspaceDiff> {
    return this.buildTaskDiffUseCase.buildTaskDiff(taskId);
  }

  @Get('checkpoints/:checkpointId/diff')
  buildCheckpointDiff(
    @Param('checkpointId', checkpointIdPipe) checkpointId: string,
  ): Promise<WorkspaceDiff> {
    return this.buildCheckpointDiffUseCase.buildCheckpointDiff(checkpointId);
  }

  @Get('checkpoints/:checkpointId/line-comments')
  listLineComments(@Param('checkpointId', checkpointIdPipe) checkpointId: string): LineComment[] {
    return this.listLineCommentsUseCase.listLineComments(checkpointId);
  }

  @Post('checkpoints/:checkpointId/line-comments')
  addLineComment(
    @Param('checkpointId', checkpointIdPipe) checkpointId: string,
    @Body(new ZodRequestPipe(addLineCommentRequestSchema)) request: AddLineCommentRequest,
  ): LineComment {
    return this.addLineCommentUseCase.addLineComment(checkpointId, request);
  }

  @Post('tasks/:taskId/reviews')
  @HttpCode(200)
  submitCodeReview(
    @Param('taskId', taskIdPipe) taskId: string,
    @Body(new ZodRequestPipe(submitCodeReviewRequestSchema)) request: SubmitCodeReviewRequest,
  ): TaskDetail {
    return this.submitCodeReviewUseCase.submitCodeReview(taskId, request);
  }

  @Post('tasks/:taskId/workspace/file-reverts')
  @HttpCode(200)
  revertWorkspaceFile(
    @Param('taskId', taskIdPipe) taskId: string,
    @Body(new ZodRequestPipe(revertWorkspaceFileRequestSchema)) request: RevertWorkspaceFileRequest,
  ): Promise<Checkpoint[]> {
    return this.revertWorkspaceFileUseCase.revertWorkspaceFile(taskId, request.path);
  }

  @Post('tasks/:taskId/pause')
  @HttpCode(200)
  pauseTask(@Param('taskId', taskIdPipe) taskId: string): TaskDetail {
    return this.pauseTaskUseCase.pauseTask(taskId);
  }

  @Post('tasks/:taskId/resume')
  @HttpCode(200)
  resumeTask(@Param('taskId', taskIdPipe) taskId: string): TaskDetail {
    return this.resumeTaskUseCase.resumeTask(taskId);
  }
}
