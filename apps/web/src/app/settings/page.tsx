import { EmptyState } from '../../shared/ui/empty-state';

export default function SettingsPage() {
  return (
    <EmptyState
      heading="Chưa có kết nối"
      description="Kiểm tra Claude Code, Codex trên máy và thêm kết nối Custom API (OpenAI-compatible hoặc Anthropic)."
      deliveredInPhase={2}
    />
  );
}
