import { EmptyState } from '../../shared/ui/empty-state';

export default function OrgChartPage() {
  return (
    <EmptyState
      heading="Chưa có phòng ban"
      description="Tạo phòng ban, thêm agent và sắp xếp cấp báo cáo tại đây."
      deliveredInPhase={1}
    />
  );
}
