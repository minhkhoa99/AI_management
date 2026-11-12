import { formatQuotaResumeTime } from '@aiteam/contracts';

/** What a log line is made from: the event kind and its stored payload. */
export interface DescribableTaskEvent {
  kind: string;
  payload: Record<string, unknown>;
}

const LINE_LIMIT = 300;

/** One readable line (Vietnamese) for a task log event; agent text is kept as plain text. */
export function describeTaskEvent(event: DescribableTaskEvent): string {
  return clipLine(describeEventText(event));
}

const DETAIL_LIMIT = 8_000;

/** The longer text behind a log line (command output, full message) and the file it touches. */
export function describeTaskEventDetail(event: DescribableTaskEvent): {
  detail: string | null;
  filePath: string | null;
} {
  const field = (key: string) =>
    typeof event.payload[key] === 'string' ? (event.payload[key] as string) : null;
  const detail =
    event.kind === 'command'
      ? field('output')
      : event.kind === 'message' || event.kind === 'step_report'
        ? field(event.kind === 'message' ? 'text' : 'summary')
        : null;
  return {
    detail: detail === null || detail.trim() === '' ? null : detail.slice(0, DETAIL_LIMIT),
    // Only paths the recorder placed inside the worktree; the monitor opens them as files.
    filePath:
      event.kind === 'file_change' && event.payload.insideWorkspace === true ? field('path') : null,
  };
}

function describeEventText(event: DescribableTaskEvent): string {
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
    case 'quota_wait':
      return `dừng vì hết hạn mức ${text('windowLabel')} của ${text('engine')}, tự chạy tiếp lúc ${text('runAfter') === '' ? '?' : formatQuotaResumeTime(text('runAfter'))}`;
    case 'failed':
      return `phiên lỗi ${text('code')}: ${text('message')}`;
    case 'turn_cancelled':
    case 'cancelled':
      return 'lượt bị dừng';
    case 'cancel_requested':
      return 'đã gửi tín hiệu huỷ';
    case 'subtasks_created':
      return `tách ${Array.isArray(payload.subtasks) ? payload.subtasks.length : 0} task con: ${describeSubtasks(payload.subtasks)}`;
    case 'subtasks_finished':
      return 'các task con đã xong, tiếp tục bước';
    case 'subtasks_ignored':
      return `không tách task con: ${text('detail')}`;
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

/** "T-5 API đăng nhập → Dev backend, T-6 …" from the subtasks_created payload. */
function describeSubtasks(subtasks: unknown): string {
  if (!Array.isArray(subtasks)) return '';
  return subtasks
    .map((subtask: unknown) => {
      const fields = (typeof subtask === 'object' && subtask !== null ? subtask : {}) as Record<
        string,
        unknown
      >;
      const field = (key: string) => (typeof fields[key] === 'string' ? fields[key] : '');
      const assignee = field('assigneeName');
      return `${field('code')} ${field('title')}${assignee === '' ? '' : ` → ${assignee}`}`.trim();
    })
    .join(', ');
}

const STEP_OUTCOME_LABELS: Record<string, string> = {
  step_passed: 'bước đạt',
  step_retried: 'thử lại bước',
  step_returned: 'quay lại bước trước',
  task_failed: 'task thất bại',
  task_succeeded: 'task hoàn thành',
};

function clipLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= LINE_LIMIT ? line : `${line.slice(0, LINE_LIMIT)}…`;
}
