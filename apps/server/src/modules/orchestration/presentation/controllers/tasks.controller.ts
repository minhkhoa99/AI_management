import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type CreateTaskRequest,
  createTaskRequestSchema,
  entityIdSchema,
  qaDocumentNameSchema,
  type TaskAttachment,
  type TaskDeletion,
  type TaskDetail,
  type TaskListQuery,
  taskListQuerySchema,
  type TaskSummary,
  type UpdateTaskRequest,
  updateTaskRequestSchema,
} from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { AttachQaDocumentUseCase } from '../../application/use-cases/attach-qa-document.use-case';
import { CreateTaskUseCase } from '../../application/use-cases/create-task.use-case';
import { DeleteTaskUseCase } from '../../application/use-cases/delete-task.use-case';
import { GetTaskDetailUseCase } from '../../application/use-cases/get-task-detail.use-case';
import { ListTasksUseCase } from '../../application/use-cases/list-tasks.use-case';
import { RemoveQaDocumentUseCase } from '../../application/use-cases/remove-qa-document.use-case';
import { UpdateTaskUseCase } from '../../application/use-cases/update-task.use-case';

const taskIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã task');
const fileNamePipe = new ZodRequestPipe(qaDocumentNameSchema, 'Tên file');

@Controller('api/tasks')
export class TasksController {
  constructor(
    private readonly listTasksUseCase: ListTasksUseCase,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
    private readonly createTaskUseCase: CreateTaskUseCase,
    private readonly updateTaskUseCase: UpdateTaskUseCase,
    private readonly deleteTaskUseCase: DeleteTaskUseCase,
    private readonly attachQaDocumentUseCase: AttachQaDocumentUseCase,
    private readonly removeQaDocumentUseCase: RemoveQaDocumentUseCase,
  ) {}

  @Get()
  listTasks(
    @Query(new ZodRequestPipe(taskListQuerySchema, 'Bộ lọc')) query: TaskListQuery,
  ): TaskSummary[] {
    return this.listTasksUseCase.listTasks(query);
  }

  @Get(':taskId')
  getTaskDetail(@Param('taskId', taskIdPipe) taskId: string): TaskDetail {
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }

  @Post()
  createTask(
    @Body(new ZodRequestPipe(createTaskRequestSchema)) request: CreateTaskRequest,
  ): Promise<TaskDetail> {
    return this.createTaskUseCase.createTask(request);
  }

  @Patch(':taskId')
  updateTask(
    @Param('taskId', taskIdPipe) taskId: string,
    @Body(new ZodRequestPipe(updateTaskRequestSchema)) request: UpdateTaskRequest,
  ): Promise<TaskDetail> {
    return this.updateTaskUseCase.updateTask(taskId, request);
  }

  @Delete(':taskId')
  @HttpCode(202)
  deleteTask(@Param('taskId', taskIdPipe) taskId: string): TaskDeletion {
    return this.deleteTaskUseCase.deleteTask(taskId);
  }

  /** Raw file bytes (application/octet-stream), one document per request. */
  @Put(':taskId/attachments')
  attachQaDocument(
    @Param('taskId', taskIdPipe) taskId: string,
    @Query('fileName', fileNamePipe) fileName: string,
    @Body() content: unknown,
  ): TaskAttachment {
    if (!Buffer.isBuffer(content)) {
      throw new ValidationError('Gửi nội dung file dạng application/octet-stream.', {
        code: 'QA_DOCUMENT_BODY_INVALID',
      });
    }
    return this.attachQaDocumentUseCase.attachQaDocument(taskId, fileName, content);
  }

  @Delete(':taskId/attachments/:attachmentId')
  @HttpCode(204)
  removeQaDocument(
    @Param('taskId', taskIdPipe) taskId: string,
    @Param('attachmentId', new ZodRequestPipe(entityIdSchema, 'Mã tài liệu')) attachmentId: string,
  ): void {
    this.removeQaDocumentUseCase.removeQaDocument(taskId, attachmentId);
  }
}
