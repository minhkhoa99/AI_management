import { Inject, Injectable } from '@nestjs/common';
import type { Approval, ApprovalStatus } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { formatTaskCode } from '../../domain/entities/task';
import {
  APPROVAL_REPOSITORY,
  type ApprovalRecord,
  type ApprovalRepository,
} from '../../domain/repositories/approval.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';

/** Approval requests with their task, as the bell and the task detail show them. */
@Injectable()
export class ApprovalPresenter {
  constructor(
    @Inject(APPROVAL_REPOSITORY) private readonly approvalRepository: ApprovalRepository,
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
  ) {}

  presentApprovals(status: ApprovalStatus | undefined): Approval[] {
    return this.approvalRepository.listApprovals(status).flatMap((approval) => {
      const presented = this.toApprovalDto(approval);
      return presented === undefined ? [] : [presented];
    });
  }

  presentApproval(approvalId: string): Approval {
    const approval = this.approvalRepository.findApproval(approvalId);
    const presented = approval === undefined ? undefined : this.toApprovalDto(approval);
    if (presented === undefined) {
      throw new NotFoundError('Không tìm thấy yêu cầu duyệt.', { code: 'APPROVAL_NOT_FOUND' });
    }
    return presented;
  }

  private toApprovalDto(approval: ApprovalRecord): Approval | undefined {
    const task = this.taskRepository.findTaskById(approval.taskId);
    if (task === undefined) return undefined;
    const state = task.toState();
    return {
      id: approval.id,
      kind: approval.kind,
      status: approval.status,
      task: {
        id: state.id,
        code: formatTaskCode(state.sequenceNumber),
        title: state.title,
        departmentId: state.departmentId,
      },
      summary: approval.summary,
      request: approval.detail.request,
      stepName: approval.detail.stepName,
      agentName: approval.detail.agentName,
      createdAt: approval.createdAt,
      decidedAt: approval.decidedAt,
      decisionNote: approval.decisionNote,
    };
  }
}
