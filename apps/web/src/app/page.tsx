import { EmptyState } from '../shared/ui/empty-state';

export default function OverviewPage() {
  return (
    <EmptyState
      heading="Chưa có dữ liệu tổng quan"
      description="Chỉ số task, agent và chi phí sẽ hiện ở đây. Bắt đầu bằng việc tạo phòng ban và agent ở Sơ đồ tổ chức."
      deliveredInPhase={1}
    />
  );
}
