import type { LocalEngine } from '@aiteam/contracts';

export interface ModelChoice {
  /** Passed to the CLI as-is (`claude --model <model>`). */
  model: string;
  label: string;
  /** What it is good for, so the owner can trade quality for tokens per agent. */
  note: string;
}

/**
 * Quick picks per local engine. Claude Code aliases always resolve to the newest model of that
 * family, so they survive model releases. Codex has no stable aliases: free text only.
 */
export const LOCAL_ENGINE_MODEL_CHOICES: Record<LocalEngine, readonly ModelChoice[]> = {
  claude_code: [
    { model: 'opus', label: 'Opus', note: 'mạnh nhất, tốn token nhất: quản lý, kiến trúc, duyệt' },
    { model: 'sonnet', label: 'Sonnet', note: 'cân bằng: code hằng ngày' },
    { model: 'haiku', label: 'Haiku', note: 'nhanh, rẻ nhất: việc nhỏ, mô tả rõ' },
  ],
  codex: [],
};
