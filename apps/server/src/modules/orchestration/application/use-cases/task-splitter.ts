import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import type { AgentReport } from '../../domain/agent-report';
import { formatTaskCode, Task } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import { listDirectSubordinates } from '../../domain/step-assignee';
import {
  assignSubtasks,
  MAX_SUBTASKS_PER_TASK,
  type SubtaskCandidate,
} from '../../domain/subtask-assignment';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  type StaffDirectory,
  type TaskEventLog,
} from '../ports/task-execution.ports';
import { TaskProgression } from './task-progression';

/**
 * Turns the subtasks an agent asked for into real tasks for its direct subordinates, when the
 * department's workflow allows it ("Cho phép agent tách task con"). Subtasks never split again
 * (one level). The parent then waits ("waiting_children") until every subtask is finished.
 */
@Injectable()
export class TaskSplitter {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly progression: TaskProgression,
  ) {}

  /** Agents who may split `task` now: available direct subordinates of `agentId`, or none. */
  listSplitCandidates(task: Task, agentId: string): SubtaskCandidate[] {
    if (task.isSubtask) return [];
    const rules = this.progression.readWorkflowRules(task.toState().workflowId);
    if (rules?.allowAgentSubsteps !== true) return [];
    return listDirectSubordinates(
      agentId,
      this.staffDirectory.listDepartmentStaff(task.departmentId),
    )
      .filter((member) => member.available)
      .flatMap((member) => {
        const snapshot = this.staffDirectory.readEngineSnapshot(member.agentId);
        return snapshot === undefined
          ? []
          : [{ agentId: member.agentId, name: snapshot.name, role: snapshot.role }];
      });
  }

  /**
   * Creates the subtasks and parks the parent (the caller saves nothing more). Returns false when
   * the report asks for none or splitting is not allowed: the turn is then judged as usual.
   */
  splitTaskIfRequested(task: Task, report: AgentReport, agentId: string): boolean {
    if (report.subtasks.length === 0) return false;
    const candidates = report.outcome === 'done' ? this.listSplitCandidates(task, agentId) : [];
    const remaining = MAX_SUBTASKS_PER_TASK - this.taskRepository.listSubtaskIds(task.id).length;
    const refusal = task.isSubtask
      ? 'Task con không được tách tiếp.'
      : remaining <= 0
        ? `Task đã có ${MAX_SUBTASKS_PER_TASK} task con, không tách thêm.`
        : candidates.length === 0
          ? 'Quy trình chưa cho tách task con, hoặc agent không có cấp dưới đang bật.'
          : null;
    if (refusal !== null) {
      this.eventLog.recordTaskEvent({
        taskId: task.id,
        agentId,
        kind: 'subtasks_ignored',
        payload: { detail: refusal },
      });
      return false;
    }

    const assignments = assignSubtasks(
      report.subtasks.slice(0, remaining),
      candidates,
      this.staffDirectory.countActiveTasksByAgent(task.departmentId),
    );
    const parent = task.toState();
    const subtasks = this.transactionRunner.runInTransaction(() =>
      assignments.map((assignment) => {
        const subtask = Task.createSubtask({
          id: this.idGenerator.generateId(),
          sequenceNumber: this.taskRepository.allocateSequenceNumber(),
          parent,
          title: assignment.request.title,
          description: assignment.request.description,
          assigneeAgentId: assignment.agentId,
        });
        this.taskRepository.insertTask(subtask);
        return subtask.toState();
      }),
    );
    task.waitForSubtasks(subtasks.length);
    this.taskRepository.updateTask(task);
    this.eventLog.recordTaskEvent({
      taskId: task.id,
      agentId,
      kind: 'subtasks_created',
      payload: {
        subtasks: subtasks.map((subtask) => ({
          code: formatTaskCode(subtask.sequenceNumber),
          title: subtask.title,
          assigneeName:
            candidates.find((candidate) => candidate.agentId === subtask.assigneeAgentId)?.name ??
            null,
        })),
      },
    });
    return true;
  }
}
