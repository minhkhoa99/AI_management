import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../../departments/domain/repositories/department.repository';
import { quoteSummary } from '../../domain/agent-report';
import { formatTaskCode, Task, type TaskState } from '../../domain/entities/task';
import type { WorkflowStepState } from '../../domain/entities/workflow';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../domain/repositories/workflow.repository';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  TASK_WORKSPACE,
  type StaffDirectory,
  type TaskEventLog,
  type TaskWorkspace,
} from '../ports/task-execution.ports';
import { TaskPlacementPolicy } from './task-placement-policy';
import { TaskProgression } from './task-progression';

export const HANDOFF_DESCRIPTION_MAX_LENGTH = 8_000;
/** "Không đạt" rounds of one handoff step before the parent stops (counted again after a retry). */
export const HANDOFF_ROUND_LIMIT = 3;
/** Step reports of the parent quoted in the child's description. */
const HANDOFF_REPORT_COUNT = 3;

type HandoffVerdict = 'passed' | 'rejected' | 'technical';

/**
 * A workflow step owned by another department: the step becomes a task of that department (its
 * default workflow, its head), forked from the parent's code, and the parent waits for it. When
 * the child ends, its verdict is the step's gate.
 */
@Injectable()
export class DepartmentHandoff {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflowRepository: WorkflowRepository,
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly placement: TaskPlacementPolicy,
    private readonly progression: TaskProgression,
  ) {}

  /** Creates the child task and parks `task` on `step`, or fails `task`; saves either way. */
  handOffStep(task: Task, step: WorkflowStepState): void {
    const parent = task.toState();
    const targetId = step.handoffDepartmentId ?? '';
    const targetName = this.departmentName(targetId);
    const targetWorkflowId = this.placement.resolveWorkflow(targetId, undefined);
    const refusal =
      this.countRejectedRounds(task.id, step.id) >= HANDOFF_ROUND_LIMIT
        ? `Quá ${HANDOFF_ROUND_LIMIT} vòng bàn giao cho phòng ${targetName}.`
        : parent.worktreePath === null
          ? 'Chưa có code để bàn giao: bước bàn giao phải đứng sau một bước có agent làm.'
          : this.hasHandoffStep(targetWorkflowId)
            ? `Quy trình mặc định của phòng ${targetName} cũng có bước giao phòng khác; nền tảng không bàn giao lồng nhau.`
            : this.staffDirectory.listDepartmentStaff(targetId).length === 0
              ? `Phòng ${targetName} chưa có thành viên để nhận bàn giao.`
              : null;
    if (refusal !== null) {
      task.fail(refusal);
      this.taskRepository.updateTask(task);
      return;
    }

    const parentCode = formatTaskCode(parent.sequenceNumber);
    const child = this.transactionRunner.runInTransaction(() => {
      const created = Task.createHandoff({
        id: this.idGenerator.generateId(),
        sequenceNumber: this.taskRepository.allocateSequenceNumber(),
        parent,
        departmentId: targetId,
        workflowId: targetWorkflowId,
        assigneeAgentId: this.placement.resolveAssignee(targetId, undefined),
        description: this.describeHandoff(task, step, parentCode),
      });
      this.taskRepository.insertTask(created);
      const createdState = created.toState();
      task.waitForHandoff(
        step.id,
        createdState.id,
        `Chờ phòng ${targetName} (${formatTaskCode(createdState.sequenceNumber)}) làm bước "${step.name}".`,
      );
      this.taskRepository.updateTask(task);
      return createdState;
    });
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId: task.assigneeAgentId,
      kind: 'handoff_sent',
      payload: {
        stepId: step.id,
        stepName: step.name,
        childTaskId: child.id,
        childCode: formatTaskCode(child.sequenceNumber),
        departmentName: targetName,
      },
    });
  }

  /**
   * The child of the parent's current handoff round ended (or was deleted): merges its code when it
   * passed, then applies its verdict to the handoff step and saves the parent.
   */
  async concludeHandoff(parentId: string): Promise<void> {
    const parent = this.taskRepository.findTaskById(parentId)?.toState();
    if (parent?.status !== 'waiting_children' || parent.handoffTaskId === null) return;
    const child = this.taskRepository.findTaskById(parent.handoffTaskId)?.toState();
    const childCode = child === undefined ? null : formatTaskCode(child.sequenceNumber);
    const departmentName = this.departmentName(
      child?.departmentId ?? this.findCurrentStep(parent)?.handoffDepartmentId ?? '',
    );
    const verdict = this.judgeHandoffChild(child);
    let mergeConflict = false;
    if (
      verdict === 'passed' &&
      child !== undefined &&
      parent.worktreePath !== null &&
      child.worktreePath !== null
    ) {
      const merge = await this.taskWorkspace.mergeSubtaskBranch(
        parent.worktreePath,
        child.id,
        `${formatTaskCode(parent.sequenceNumber)}: gộp bàn giao ${childCode}`,
      );
      mergeConflict = merge === 'conflict';
    }

    // Merging took time: the parent may have been deleted or changed meanwhile.
    const current = this.taskRepository.findTaskById(parentId);
    if (current?.status !== 'waiting_children') return;
    current.finishHandoff();
    if (verdict === 'passed') {
      if (mergeConflict) {
        current.addFeedback(
          `Code của phòng ${departmentName} (${childCode}) KHÔNG được gộp vì xung đột; nhánh agent/${parent.handoffTaskId} vẫn còn, tự gộp hoặc làm lại phần này.`,
        );
      }
      this.progression.applyGateResult(current, true, null);
    } else if (verdict === 'rejected') {
      this.progression.applyGateResult(
        current,
        false,
        `Phòng ${departmentName} (${childCode}) không đạt: ${child?.statusNote ?? ''}`,
      );
    } else {
      current.fail(
        `Phòng ${departmentName} lỗi kỹ thuật (${childCode ?? 'task đã xoá'}). Bấm chạy lại để bàn giao vòng mới.`,
      );
    }
    this.taskRepository.updateTask(current);
    this.eventLog.recordTaskEvent({
      taskId: parentId,
      agentId: current.assigneeAgentId,
      kind: 'handoff_returned',
      payload: {
        stepId: parent.currentStepId,
        childTaskId: parent.handoffTaskId,
        childCode,
        departmentName,
        verdict,
      },
    });
  }

  /** Only a gate the other department judged "không đạt" sends the work back; the rest is technical. */
  private judgeHandoffChild(child: TaskState | undefined): HandoffVerdict {
    if (child?.status === 'succeeded') return 'passed';
    if (
      child?.status === 'failed' &&
      this.eventLog.listTaskEventsOfKinds(child.id, ['task_failed'])[0]?.payload.reason ===
        'gate_rejected'
    ) {
      return 'rejected';
    }
    return 'technical';
  }

  /** "Không đạt" verdicts returned for `stepId` since the user last retried the task. */
  private countRejectedRounds(taskId: string, stepId: string): number {
    let rejected = 0;
    for (const event of this.eventLog.listTaskEventsOfKinds(taskId, [
      'handoff_returned',
      'task_retried',
    ])) {
      if (event.kind === 'task_retried') break;
      if (event.payload.stepId === stepId && event.payload.verdict === 'rejected') rejected += 1;
    }
    return rejected;
  }

  private findCurrentStep(parent: TaskState): WorkflowStepState | undefined {
    return this.progression
      .resolveTaskRoute(parent.workflowId)
      ?.steps.find((step) => step.id === parent.currentStepId);
  }

  private hasHandoffStep(workflowId: string | null): boolean {
    const workflow =
      workflowId === null ? undefined : this.workflowRepository.findWorkflowById(workflowId);
    return workflow?.toState().steps.some((step) => step.ownerRole === 'department') ?? false;
  }

  private departmentName(departmentId: string): string {
    return this.departmentRepository.findDepartmentById(departmentId)?.name ?? departmentId;
  }

  /** What the other department reads: the step, its expected output, the brief and recent results. */
  private describeHandoff(task: Task, step: WorkflowStepState, parentCode: string): string {
    const parent = task.toState();
    const sections = [
      `Phòng ${this.departmentName(parent.departmentId)} bàn giao bước «${step.name}» của ${parentCode} "${parent.title}".`,
    ];
    if (step.requiredOutput.trim() !== '') {
      sections.push(`Đầu ra cần có: ${step.requiredOutput.trim()}`);
    }
    if (parent.description !== '') sections.push(`Mô tả gốc:\n${parent.description}`);
    const reports = this.eventLog.listStepReports(task.id).slice(-HANDOFF_REPORT_COUNT);
    if (reports.length > 0) {
      sections.push(
        [
          'Kết quả các bước trước:',
          ...reports.map(
            (report) =>
              `- ${report.stepName} (${report.agentName}): ${quoteSummary(report.summary)}`,
          ),
        ].join('\n'),
      );
    }
    return sections.join('\n\n').slice(0, HANDOFF_DESCRIPTION_MAX_LENGTH);
  }
}
