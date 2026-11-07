import { Inject, Injectable } from '@nestjs/common';
import type { SubmitCodeReviewRequest, TaskDetail } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ConflictError, ValidationError } from '../../../../shared/errors/app-error';
import {
  APPROVAL_REPOSITORY,
  type ApprovalRepository,
} from '../../domain/repositories/approval.repository';
import {
  CHECKPOINT_REPOSITORY,
  type CheckpointRepository,
  LINE_COMMENT_REPOSITORY,
  type LineCommentRepository,
} from '../../domain/repositories/checkpoint.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { requireCheckpoint } from './checkpoint-lookup';
import { DecideApprovalUseCase } from './decide-approval.use-case';
import { GetTaskDetailUseCase } from './get-task-detail.use-case';
import { TaskProgression } from './task-progression';
import { TaskWorkspaceAccess } from './task-workspace-access';

/**
 * "Duyệt thay đổi": passes the pending approval of the task, if any. "Yêu cầu sửa": the task goes
 * back to the step that produced the checkpoint, the same agent gets the line comments (and
 * continues its session when it can), then the workflow goes on as usual.
 */
@Injectable()
export class SubmitCodeReviewUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(CHECKPOINT_REPOSITORY) private readonly checkpointRepository: CheckpointRepository,
    @Inject(LINE_COMMENT_REPOSITORY) private readonly commentRepository: LineCommentRepository,
    @Inject(APPROVAL_REPOSITORY) private readonly approvalRepository: ApprovalRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly workspaceAccess: TaskWorkspaceAccess,
    private readonly progression: TaskProgression,
    private readonly decideApprovalUseCase: DecideApprovalUseCase,
    private readonly getTaskDetailUseCase: GetTaskDetailUseCase,
  ) {}

  submitCodeReview(taskId: string, request: SubmitCodeReviewRequest): TaskDetail {
    const checkpoint = requireCheckpoint(this.checkpointRepository, request.checkpointId);
    if (checkpoint.taskId !== taskId) {
      throw new ValidationError('Mốc này không thuộc task.', { code: 'CHECKPOINT_NOT_IN_TASK' });
    }
    const openComments = this.commentRepository
      .listLineComments(checkpoint.id)
      .filter((comment) => comment.status === 'open');
    if (request.decision === 'approve') {
      this.approveChanges(
        taskId,
        checkpoint.id,
        openComments.map((comment) => comment.id),
        request.note,
      );
      return this.getTaskDetailUseCase.getTaskDetail(taskId);
    }
    if (openComments.length === 0 && request.note === '') {
      throw new ValidationError('Thêm góp ý theo dòng hoặc ghi chú trước khi yêu cầu sửa.', {
        code: 'REVIEW_WITHOUT_FEEDBACK',
      });
    }
    this.transactionRunner.runInTransaction(() => {
      const { task } = this.workspaceAccess.requireIdleTaskWorktree(taskId);
      const pending = this.approvalRepository.findPendingApprovalOfTask(taskId);
      if (pending !== undefined) {
        this.approvalRepository.recordDecision(pending.id, false, 'Bạn yêu cầu sửa theo góp ý.');
      }
      const lines = openComments.map(
        (comment) => `- ${comment.filePath}:${comment.line} — ${comment.body}`,
      );
      task.addFeedback(
        [
          `Người dùng xem mốc ${checkpoint.sha.slice(0, 7)} và yêu cầu sửa:`,
          ...lines,
          request.note === '' ? '' : `Ghi chú: ${request.note}`,
          'Sửa đúng các điểm này rồi báo xong.',
        ]
          .filter((line) => line !== '')
          .join('\n'),
      );
      const route = this.progression.resolveTaskRoute(task.toState().workflowId);
      const stepId =
        checkpoint.stepId !== null && route?.steps.some((step) => step.id === checkpoint.stepId)
          ? checkpoint.stepId
          : task.currentStepId;
      if (checkpoint.agentId !== null) task.assignTo(checkpoint.agentId);
      task.requeue({ stepId, retriesUsed: 0, note: 'Bạn yêu cầu sửa theo góp ý.' });
      this.taskRepository.updateTask(task);
      this.commentRepository.changeLineCommentStatus(
        openComments.map((comment) => comment.id),
        'sent',
      );
      this.eventLog.recordTaskEvent({
        taskId,
        agentId: null,
        kind: 'review_submitted',
        payload: { decision: 'request_changes', commentCount: openComments.length },
      });
    });
    return this.getTaskDetailUseCase.getTaskDetail(taskId);
  }

  private approveChanges(
    taskId: string,
    checkpointId: string,
    openCommentIds: string[],
    note: string,
  ): void {
    const pending = this.approvalRepository.findPendingApprovalOfTask(taskId);
    if (pending !== undefined) {
      this.decideApprovalUseCase.decideApproval(pending.id, { approved: true, note });
    } else if (this.taskRepository.findTaskById(taskId) === undefined) {
      throw new ConflictError('Task không còn tồn tại.', { code: 'TASK_NOT_FOUND' });
    }
    this.commentRepository.changeLineCommentStatus(openCommentIds, 'resolved');
    this.eventLog.recordTaskEvent({
      taskId,
      agentId: null,
      kind: 'review_submitted',
      payload: { decision: 'approve', checkpointId },
    });
  }
}
