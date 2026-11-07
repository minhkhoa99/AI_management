import { Injectable } from '@nestjs/common';
import type { Approval, ApprovalStatus } from '@aiteam/contracts';
import { ApprovalPresenter } from './approval-presenter';

/** Bell in the top bar and "Chờ bạn duyệt": newest first. */
@Injectable()
export class ListApprovalsUseCase {
  constructor(private readonly approvalPresenter: ApprovalPresenter) {}

  listApprovals(status: ApprovalStatus | undefined): Approval[] {
    return this.approvalPresenter.presentApprovals(status);
  }
}
