import { Inject, Injectable } from '@nestjs/common';
import { buildCompletionGoal, type TaskDetail } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import {
  TASK_ATTACHMENT_REPOSITORY,
  type TaskAttachmentRepository,
} from '../../domain/repositories/task-attachment.repository';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  APPROVAL_REPOSITORY,
  type ApprovalRepository,
} from '../../domain/repositories/approval.repository';
import {
  TASK_DELEGATION_REPOSITORY,
  type TaskDelegationRepository,
} from '../../domain/repositories/task-delegation.repository';
import { TASK_BOARD_QUERY, type TaskBoardQuery } from '../ports/task-board.query';
import { TaskHandover } from './task-handover';
import { TaskProgression } from './task-progression';

@Injectable()
export class GetTaskDetailUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: TaskAttachmentRepository,
    @Inject(TASK_BOARD_QUERY) private readonly taskBoardQuery: TaskBoardQuery,
    @Inject(TASK_DELEGATION_REPOSITORY)
    private readonly delegationRepository: TaskDelegationRepository,
    @Inject(APPROVAL_REPOSITORY) private readonly approvalRepository: ApprovalRepository,
    private readonly taskHandover: TaskHandover,
    private readonly progression: TaskProgression,
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
      previewCommand: state.previewCommand,
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
      delegations: this.delegationRepository.listDelegations(taskId),
      delegationTargets: this.listDelegationTargets(taskId, summary.departmentId),
      pendingApprovalId: this.approvalRepository.findPendingApprovalOfTask(taskId)?.id ?? null,
      workflowSteps:
        this.progression
          .resolveTaskRoute(state.workflowId)
          ?.steps.map((step) => ({ id: step.id, name: step.name, gate: step.gate })) ?? [],
    };
  }

  private listDelegationTargets(taskId: string, departmentId: string) {
    const task = this.taskRepository.findTaskById(taskId);
    if (task === undefined) return [];
    const targetIds = new Set(
      this.taskHandover.listDelegationTargets(task).map((member) => member.agentId),
    );
    return this.taskBoardQuery
      .listDepartmentAgents(departmentId)
      .filter((agent) => targetIds.has(agent.id));
  }
}

export function requireTaskExists(taskRepository: TaskRepository, taskId: string) {
  const task = taskRepository.findTaskById(taskId);
  if (task === undefined) {
    throw new NotFoundError('Không tìm thấy task.', { code: 'TASK_NOT_FOUND' });
  }
  return task;
}
