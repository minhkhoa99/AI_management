import { Inject, Injectable } from '@nestjs/common';
import type { TaskStatus } from '@aiteam/contracts';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import { formatTaskCode, type TaskState } from '../../domain/entities/task';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  STAFF_DIRECTORY,
  TASK_EVENT_LOG,
  TASK_WORKSPACE,
  type StaffDirectory,
  type TaskEventLog,
  type TaskWorkspace,
} from '../ports/task-execution.ports';

const SUBTASK_SUMMARY_MAX_LENGTH = 1_200;
const OUTCOME_LABELS: Partial<Record<TaskStatus, string>> = {
  succeeded: 'đạt',
  failed: 'thất bại',
  cancelled: 'đã huỷ',
};

/**
 * When every subtask of a waiting task has finished: merges the code of the successful ones into
 * the parent's worktree, then puts the parent back in the queue on the same step. The same agent
 * continues its session with each subtask's result and finishes the step.
 */
@Injectable()
export class ResumeSplitTasksUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_WORKSPACE) private readonly taskWorkspace: TaskWorkspace,
    @Inject(STAFF_DIRECTORY) private readonly staffDirectory: StaffDirectory,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Never rejects: a parent that cannot be resumed is logged and tried again next pass. */
  async resumeTasksWithFinishedSubtasks(): Promise<void> {
    for (const parentId of this.taskRepository.listParentIdsReadyToResume()) {
      try {
        await this.resumeParentTask(parentId);
      } catch (error) {
        this.logger.error({ err: error, taskId: parentId }, 'task could not resume after subtasks');
      }
    }
  }

  private async resumeParentTask(parentId: string): Promise<void> {
    const parent = this.taskRepository.findTaskById(parentId)?.toState();
    if (parent === undefined || parent.status !== 'waiting_children') return;
    const parentCode = formatTaskCode(parent.sequenceNumber);
    const results: string[] = [];
    for (const subtaskId of this.taskRepository.listSubtaskIds(parentId)) {
      const subtask = this.taskRepository.findTaskById(subtaskId)?.toState();
      if (subtask !== undefined) {
        results.push(await this.reportSubtask(parent, parentCode, subtask));
      }
    }

    // Merging took time: the parent may have been deleted or changed meanwhile.
    const current = this.taskRepository.findTaskById(parentId);
    if (current === undefined || current.status !== 'waiting_children') return;
    const feedback =
      results.length === 0
        ? 'Các task con bạn giao đã bị xoá. Tự làm nốt phần việc của bước rồi báo cáo như thường.'
        : [
            'Các task con bạn giao cho cấp dưới đã kết thúc:',
            ...results,
            'Code của các task con đạt đã được gộp vào thư mục làm việc của bạn (trừ chỗ ghi xung đột). Kiểm tra kết quả, làm nốt phần còn lại của bước rồi báo cáo như thường. Chỉ tách task con lần nữa khi thật cần.',
          ].join('\n');
    current.resumeAfterSubtasks(feedback);
    this.taskRepository.updateTask(current);
    this.eventLog.recordTaskEvent({
      taskId: parentId,
      agentId: current.assigneeAgentId,
      kind: 'subtasks_finished',
      payload: { detail: results.join('\n') },
    });
  }

  /** One line for the parent's agent; merges the subtask's branch first when it succeeded. */
  private async reportSubtask(
    parent: TaskState,
    parentCode: string,
    subtask: TaskState,
  ): Promise<string> {
    const code = formatTaskCode(subtask.sequenceNumber);
    let mergeNote = '';
    if (
      subtask.status === 'succeeded' &&
      parent.worktreePath !== null &&
      subtask.worktreePath !== null
    ) {
      const merge = await this.taskWorkspace.mergeSubtaskBranch(
        parent.worktreePath,
        subtask.id,
        `${parentCode}: gộp task con ${code} ${subtask.title}`,
      );
      if (merge === 'conflict') {
        mergeNote = ` Code KHÔNG được gộp vì xung đột; nhánh agent/${subtask.id} vẫn còn, bạn tự gộp hoặc làm lại phần này.`;
      }
    }
    const assigneeName =
      subtask.assigneeAgentId === null
        ? 'không rõ'
        : (this.staffDirectory.readEngineSnapshot(subtask.assigneeAgentId)?.name ?? 'không rõ');
    const summary =
      this.eventLog.listStepReports(subtask.id).at(-1)?.summary ?? subtask.statusNote ?? '';
    const outcome = OUTCOME_LABELS[subtask.status] ?? subtask.status;
    return `- ${code} "${subtask.title}" (${assigneeName}): ${outcome}. ${clip(summary)}${mergeNote}`;
  }
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= SUBTASK_SUMMARY_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, SUBTASK_SUMMARY_MAX_LENGTH)}…`;
}
