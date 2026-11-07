import type { DelegationReason } from '@aiteam/contracts';

export const TASK_DELEGATION_REPOSITORY = Symbol('TASK_DELEGATION_REPOSITORY');

export interface TaskDelegationRecord {
  fromAgentName: string | null;
  toAgentName: string | null;
  reason: DelegationReason;
  createdAt: string;
}

export interface TaskDelegationRepository {
  recordDelegation(input: {
    id: string;
    taskId: string;
    fromAgentId: string | null;
    toAgentId: string;
    reason: DelegationReason;
  }): void;
  /** Oldest first. */
  listDelegations(taskId: string): TaskDelegationRecord[];
}
