import { Inject, Injectable } from '@nestjs/common';
import type { TaskEvent } from '@aiteam/contracts';
import { TASK_REPOSITORY, type TaskRepository } from '../../domain/repositories/task.repository';
import {
  TASK_EVENT_LOG,
  type TaskEventLog,
  type TaskEventRecord,
} from '../ports/task-execution.ports';
import { requireTaskExists } from './get-task-detail.use-case';

const LINE_LIMIT = 300;

/** "Nhật ký task": the latest events of a task, one readable line each. */
@Injectable()
export class ListTaskEventsUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: TaskRepository,
    @Inject(TASK_EVENT_LOG) private readonly eventLog: TaskEventLog,
  ) {}

  listTaskEvents(taskId: string, limit: number): TaskEvent[] {
    requireTaskExists(this.taskRepository, taskId);
    return this.eventLog.listTaskEvents(taskId, limit).map((event) => ({
      id: event.id,
      kind: event.kind,
      agentName: event.agentName,
      text: clip(describeTaskEvent(event)),
      createdAt: event.createdAt,
    }));
  }
}

function describeTaskEvent(event: TaskEventRecord): string {
  const payload = event.payload;
  const text = (key: string) => (typeof payload[key] === 'string' ? payload[key] : '');
  switch (event.kind) {
    case 'turn_started':
      return `bắt đầu "${text('stepName')}"${payload.resumed === true ? ' (tiếp tục phiên cũ)' : ''}`;
    case 'message':
      return text('text');
    case 'tool_call':
      return `dùng ${text('toolName')}: ${text('detail')}`;
    case 'command':
      return `chạy lệnh: ${text('command')}${payload.exitCode === null || payload.exitCode === undefined ? '' : ` (exit ${String(payload.exitCode)})`}`;
    case 'file_change':
      return `${text('changeKind') === 'add' ? 'tạo' : text('changeKind') === 'delete' ? 'xoá' : 'sửa'} ${text('path')}`;
    case 'step_report':
      return `báo cáo "${text('stepName')}" (${text('outcome')}): ${text('summary')}`;
    case 'checkpoint':
      return `lưu mốc ${text('sha').slice(0, 7)} (${String(payload.fileCount ?? 0)} file)`;
    case 'gate_evaluated':
      return `điều kiện chuyển bước: ${payload.passed === true ? 'đạt' : 'không đạt'}${text('detail') === '' ? '' : ` – ${text('detail')}`}`;
    case 'review_started':
      return `cấp trên bắt đầu duyệt "${text('stepName')}"`;
    case 'review_finished':
      return `cấp trên ${payload.passed === true ? 'duyệt đạt' : 'yêu cầu sửa'}: ${text('summary')}`;
    case 'approval_requested':
      return `chờ bạn duyệt: ${text('summary')}`;
    case 'approval_decided':
      return `bạn ${payload.approved === true ? 'đã duyệt' : 'đã từ chối'}${text('note') === '' ? '' : `: ${text('note')}`}`;
    case 'delegated':
      return text('reason') === 'manual' ? 'được giao task' : 'được tự động giao task';
    case 'engine_failed':
      return `bộ não báo lỗi ${text('code')}: ${text('message')}`;
    case 'failed':
      return `phiên lỗi ${text('code')}: ${text('message')}`;
    case 'turn_cancelled':
    case 'cancelled':
      return 'lượt bị dừng';
    case 'cancel_requested':
      return 'đã gửi tín hiệu huỷ';
    case 'step_passed':
    case 'step_retried':
    case 'step_returned':
    case 'task_failed':
    case 'task_succeeded':
      return `${STEP_OUTCOME_LABELS[event.kind] ?? event.kind}${text('detail') === '' ? '' : `: ${text('detail')}`}`;
    default:
      return event.kind;
  }
}

const STEP_OUTCOME_LABELS: Record<string, string> = {
  step_passed: 'bước đạt',
  step_retried: 'thử lại bước',
  step_returned: 'quay lại bước trước',
  task_failed: 'task thất bại',
  task_succeeded: 'task hoàn thành',
};

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= LINE_LIMIT ? line : `${line.slice(0, LINE_LIMIT)}…`;
}
