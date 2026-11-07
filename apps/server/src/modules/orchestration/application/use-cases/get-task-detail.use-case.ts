import { Inject, Injectable } from '@nestjs/common';
import { buildCompletionGoal, type TaskDetail } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_BOARD_QUERY, type TaskBoardQuery } from '../ports/task-board.query';

@Injectable()
export class GetTaskDetailUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(TASK_BOARD_QUERY) private readonly taskBoardQuery: TaskBoardQuery,
  ) {}

  getTaskDetail(taskId: string): TaskDetail {
    const task = this.taskRepository.findTaskById(taskId);
    const summary = this.taskBoardQuery.findTaskSummary(taskId);
    if (task === undefined || summary === undefined) {
      throw new NotFoundError('Không tìm thấy task.', { code: 'TASK_NOT_FOUND' });
    }
    const state = task.toState();
    const attachments = this.attachmentRepository.listAttachments(taskId).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      size: attachment.size,
      detectedCases: attachment.detectedCases,
    }));
    return {
      ...summary,
      description: state.description,
      criteria: state.criteria,
      testCommand: state.testCommand,
      attachments,
      assigneeChain:
        state.assigneeAgentId === null
          ? []
          : this.taskBoardQuery.listReportingChain(state.assigneeAgentId),
      completionGoal: buildCompletionGoal({
        description: state.description,
        criteria: state.criteria,
        qaDocuments: attachments,
      }),
    };
  }
}

export function requireTaskExists(taskRepository: TaskRepository, taskId: string) {
  const task = taskRepository.findTaskById(taskId);
  if (task === undefined) {
    throw new NotFoundError('Không tìm thấy task.', { code: 'TASK_NOT_FOUND' });
  }
  return task;
}
