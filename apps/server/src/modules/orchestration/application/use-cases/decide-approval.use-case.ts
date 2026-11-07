import { Inject, Injectable } from '@nestjs/common';
import type { Approval, DecideApprovalRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ConflictError, NotFoundError } from '../../../../shared/errors/app-error';
import {
  APPROVAL_REPOSITORY,
  type ApprovalRecord,
  type ApprovalRepository,
} from '../../domain/repositories/approval.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';
import { ApprovalPresenter } from './approval-presenter';
import { TaskProgression } from './task-progression';

/**
 * The user's answer. A step gate: approved passes the step, rejected fails it (on_fail rules).
 * Sensitive work: approved lets the same agent continue its session; rejected fails the step.
 */
@Injectable()
export class DecideApprovalUseCase {
  constructor(
    @Inject(APPROVAL_REPOSITORY) private readonly approvalRepository: ApprovalRepository,
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly progression: TaskProgression,
    private readonly approvalPresenter: ApprovalPresenter,
  ) {}

  decideApproval(approvalId: string, request: DecideApprovalRequest): Approval {
    this.transactionRunner.runInTransaction(() => {
      const approval = this.approvalRepository.findApproval(approvalId);
      if (approval === undefined) {
        throw new NotFoundError('Không tìm thấy yêu cầu duyệt.', { code: 'APPROVAL_NOT_FOUND' });
      }
      const note = request.note === '' ? null : request.note;
      if (!this.approvalRepository.recordDecision(approvalId, request.approved, note)) {
        throw new ConflictError('Yêu cầu này đã được duyệt hoặc từ chối.', {
          code: 'APPROVAL_ALREADY_DECIDED',
        });
      }
      this.continueTask(approval, request.approved, note);
    });
    return this.approvalPresenter.presentApproval(approvalId);
  }

  private continueTask(approval: ApprovalRecord, approved: boolean, note: string | null): void {
    const task = this.taskRepository.findTaskById(approval.taskId);
    if (task === undefined || task.status !== 'waiting_approval') return;
    const noteText = note === null ? '' : ` Ghi chú: ${note}`;
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: null,
      kind: 'approval_decided',
      payload: { approved, note, approvalKind: approval.kind },
    });
    if (approval.kind === 'sensitive_action' && approved) {
      const state = task.toState();
      task.addFeedback(
        `Người dùng đã DUYỆT việc bạn xin: ${approval.detail.request}${noteText} Hãy làm tiếp và hoàn thành phần việc.`,
      );
      task.requeue({ stepId: state.currentStepId, retriesUsed: state.stepAttempt });
    } else {
      const reason =
        approval.kind === 'sensitive_action'
          ? `Người dùng TỪ CHỐI việc nhạy cảm: ${approval.detail.request}.${noteText} Tìm cách khác không cần việc này.`
          : `Người dùng từ chối kết quả bước.${noteText}`;
      this.progression.applyGateResult(task, approved, approved ? null : reason);
    }
    this.taskRepository.updateTask(task);
  }
}
