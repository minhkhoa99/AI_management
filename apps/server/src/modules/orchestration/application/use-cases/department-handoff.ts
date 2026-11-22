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
import { formatTaskCode, Task } from '../../domain/entities/task';
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
import { clip } from './resume-split-tasks.use-case';
import { TaskPlacementPolicy } from './task-placement-policy';
import { TaskProgression } from './task-progression';

export const HANDOFF_DESCRIPTION_MAX_LENGTH = 8_000;
/** Step reports of the parent quoted in the child's description. */
const HANDOFF_REPORT_COUNT = 3;

/**
 * A workflow step owned by another department: the step becomes a task of that department (its
 * default workflow, its head), forked from the parent's code, and the parent waits for it.
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
      parent.worktreePath === null
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
            (report) => `- ${report.stepName} (${report.agentName}): ${clip(report.summary)}`,
          ),
        ].join('\n'),
      );
    }
    return sections.join('\n\n').slice(0, HANDOFF_DESCRIPTION_MAX_LENGTH);
  }
}
