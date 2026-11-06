import { EmptyState } from '../../shared/ui/empty-state';

export default function TasksPage() {
  return (
    <EmptyState
      heading="Chưa có task"
      description="Tạo task, giao cho agent và theo dõi qua các giai đoạn trên bảng kanban."
      deliveredInPhase={3}
    />
  );
}
