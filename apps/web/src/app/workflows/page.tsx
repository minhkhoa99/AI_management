import { EmptyState } from '../../shared/ui/empty-state';

export default function WorkflowsPage() {
  return (
    <EmptyState
      heading="Chưa có quy trình"
      description="Định nghĩa các bước, điều kiện chuyển bước và hành vi khi không đạt cho từng phòng."
      deliveredInPhase={3}
    />
  );
}
