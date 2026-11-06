import type { AgentProvider, AgentRole, TeamMode } from '@aiteam/contracts';

export const ROLE_LABELS: Record<AgentRole, string> = {
  // eslint-disable-next-line id-denylist -- role value from AGENT_ROLES (contracts), not a vague name
  manager: 'Manager',
  pm: 'PM',
  dev: 'Dev',
  qc: 'QC',
  designer: 'Designer',
  writer: 'Writer',
  analyst: 'Analyst',
  support: 'Support',
};

export interface ProviderPresentation {
  label: string;
  note: string;
  background: string;
  foreground: string;
}

/** Colours follow the design mockup (Claude Code blue, Codex green, Custom API amber). */
export const PROVIDER_PRESENTATION: Record<AgentProvider, ProviderPresentation> = {
  claude_code: {
    label: 'Claude Code',
    note: 'Tài khoản Claude đã đăng nhập',
    background: '#1C3256',
    foreground: '#B9D3FF',
  },
  codex: {
    label: 'Codex',
    note: 'Tài khoản ChatGPT đã đăng nhập',
    background: '#113329',
    foreground: '#86E8C4',
  },
  custom_api: {
    label: 'Custom API',
    note: 'OpenAI-compatible hoặc Anthropic',
    background: '#3A2A12',
    foreground: '#F7CD90',
  },
};

export const TEAM_MODE_PRESENTATION: Record<TeamMode, { label: string; hint: string }> = {
  orchestrator: {
    label: 'Orchestrator riêng',
    hint: 'Nền tảng tự điều phối từng agent, mỗi agent dùng bộ não riêng.',
  },
  claude_code_teams: {
    label: 'Claude Code agent teams',
    hint: 'Cả phòng giao cho một phiên Claude Code bật agent teams; nền tảng đọc log và hook.',
  },
  codex_subagents: {
    label: 'Codex subagents',
    hint: 'Cả phòng giao cho Codex lead điều phối subagent; nền tảng đọc log và hook.',
  },
};

/** Palette offered when creating or recolouring a department (first three from the design). */
export const DEPARTMENT_COLOR_CHOICES = [
  '#60A5FA',
  '#F472B6',
  '#2DD4BF',
  '#A78BFA',
  '#FBBF24',
  '#F97316',
  '#34D399',
  '#F87171',
] as const;

export function buildInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0]?.[0] ?? ''}${words[words.length - 1]?.[0] ?? ''}`
      : (words[0] ?? '').slice(0, 2);
  return initials.toLocaleUpperCase('vi');
}

export function buildOrgHref(departmentId: string, agentId?: string): string {
  const searchParams = new URLSearchParams({ dept: departmentId });
  if (agentId !== undefined) {
    searchParams.set('agent', agentId);
  }
  return `/org/?${searchParams.toString()}`;
}
