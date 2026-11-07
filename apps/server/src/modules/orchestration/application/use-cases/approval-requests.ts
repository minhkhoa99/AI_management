import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalKind } from '@aiteam/contracts';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import type { Task } from '../../domain/entities/task';
import {
  APPROVAL_REPOSITORY,
  type ApprovalRepository,
} from '../../domain/repositories/approval.repository';
import { TASK_EVENT_LOG, type TaskEventLog } from '../ports/task-execution.ports';

/** Puts a task on hold until the user decides (bell in the top bar, task detail). */
@Injectable()
export class ApprovalRequests {
  constructor(
    @Inject(APPROVAL_REPOSITORY) private readonly approvalRepository: ApprovalRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  /** Mutates the task (waiting_approval); the caller saves it. */
  requestApproval(
    task: Task,
    input: {
      kind: ApprovalKind;
      summary: string;
      request: string;
      step: { id: string; name: string } | null;
      agent: { id: string; name: string } | null;
    },
  ): void {
    this.approvalRepository.insertApproval({
      id: this.idGenerator.generateId(),
      taskId: task.id,
      kind: input.kind,
      summary: input.summary,
      detail: {
        stepId: input.step?.id ?? null,
        stepName: input.step?.name ?? null,
        agentId: input.agent?.id ?? null,
        agentName: input.agent?.name ?? null,
        request: input.request,
      },
    });
    task.waitForApproval(input.summary);
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: input.agent?.id ?? null,
      kind: 'approval_requested',
      payload: { approvalKind: input.kind, summary: input.summary },
    });
  }
}
