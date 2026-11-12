import type { LocalEngineModelChoice } from '@aiteam/contracts';

/**
 * Claude Code model aliases, shown only when Claude Code's own list cannot be read. The CLI
 * resolves each one to the newest model of that family, so they keep working as models are released.
 */
export const CLAUDE_CODE_MODEL_CHOICES: readonly LocalEngineModelChoice[] = [
  { model: 'opus', label: 'Opus', note: 'mạnh nhất, tốn token nhất: quản lý, kiến trúc, duyệt' },
  { model: 'sonnet', label: 'Sonnet', note: 'cân bằng: code hằng ngày' },
  { model: 'haiku', label: 'Haiku', note: 'nhanh, rẻ nhất: việc nhỏ, mô tả rõ' },
  {
    model: 'fable',
    label: 'Fable',
    note: 'mới nhất; tài khoản cần bật usage credits trên claude.ai',
  },
];
