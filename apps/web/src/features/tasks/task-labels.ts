import type { TaskBoardColumn, TaskPriority, TaskStatus } from '@aiteam/contracts';

export const BOARD_COLUMN_PRESENTATION: Record<TaskBoardColumn, { label: string; color: string }> =
  {
    todo: { label: 'Cần làm', color: '#9AA8C1' },
    in_progress: { label: 'Đang làm', color: '#60A5FA' },
    qc: { label: 'QC đang kiểm', color: '#FBBF24' },
    done: { label: 'Hoàn thành', color: '#34D399' },
  };

export const PRIORITY_PRESENTATION: Record<
  TaskPriority,
  { label: string; background: string; foreground: string }
> = {
  1: { label: 'Cao', background: '#3A2010', foreground: '#FDBA8C' },
  2: { label: 'Vừa', background: '#16305A', foreground: '#BFD8FF' },
  3: { label: 'Thấp', background: '#1C2438', foreground: '#C5D0E3' },
};

/** Status line on a card, for states the column alone does not explain. */
export const STATUS_NOTES: Partial<Record<TaskStatus, string>> = {
  waiting_children: 'Chờ cấp dưới',
  waiting_approval: 'Chờ bạn duyệt',
  failed: 'Thất bại, cần xem lại',
  cancelling: 'Đã gửi tín hiệu huỷ, chờ agent dừng…',
  cancelled: 'Đã huỷ',
};

/** Last two folders of a path, for chips ("…/shop-api/src"). */
export function shortenDirectory(directoryPath: string): string {
  const segments = directoryPath.split(/[\\/]+/).filter(Boolean);
  return segments.length <= 2 ? directoryPath : `…/${segments.slice(-2).join('/')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toLocaleString('vi', { maximumFractionDigits: 1 })} KB`;
  return `${(kilobytes / 1024).toLocaleString('vi', { maximumFractionDigits: 1 })} MB`;
}

/** Statuses the platform is working on; screens refresh while a task is in one of them. */
export function isTaskActive(status: TaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'cancelling' ||
    status === 'waiting_children'
  );
}
