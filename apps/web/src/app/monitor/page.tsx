import { EmptyState } from '../../shared/ui/empty-state';

export default function MonitorPage() {
  return (
    <EmptyState
      heading="Chưa có agent nào đang chạy"
      description="Terminal, cây thư mục, diff theo mốc và xem trước giao diện của từng agent sẽ hiện ở đây."
      deliveredInPhase={4}
    />
  );
}
