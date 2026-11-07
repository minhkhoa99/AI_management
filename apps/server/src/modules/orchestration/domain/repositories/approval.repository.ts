import type { ApprovalKind, ApprovalStatus } from '@aiteam/contracts';

export const APPROVAL_REPOSITORY = Symbol('APPROVAL_REPOSITORY');

export interface ApprovalRecord {
  id: string;
  taskId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  summary: string;
  detail: {
    stepId: string | null;
    stepName: string | null;
    agentId: string | null;
    agentName: string | null;
    request: string;
  };
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalRepository {
  insertApproval(
    approval: Omit<ApprovalRecord, 'status' | 'createdAt' | 'decidedAt' | 'decisionNote'>,
  ): void;
  findApproval(approvalId: string): ApprovalRecord | undefined;
  findPendingApprovalOfTask(taskId: string): ApprovalRecord | undefined;
  /** Newest first. */
  listApprovals(status: ApprovalStatus | undefined): ApprovalRecord[];
  /** Only a pending approval can be decided; returns false when it was decided already. */
  recordDecision(approvalId: string, approved: boolean, note: string | null): boolean;
}
