import type { AgentProvider } from '@aiteam/contracts';
import { controlStyles } from '../../../shared/ui/controls';
import { buildInitials, PROVIDER_PRESENTATION } from '../organization-labels';

export function ProviderBadge({ provider }: { provider: AgentProvider }) {
  const presentation = PROVIDER_PRESENTATION[provider];
  return (
    <span
      className={controlStyles.badge}
      style={{ background: presentation.background, color: presentation.foreground }}
    >
      {presentation.label}
    </span>
  );
}

interface AgentAvatarProps {
  name: string;
  provider: AgentProvider;
  available: boolean;
  size?: number;
}

/** Initials coloured by provider; the ring shows availability (green on, grey off). */
export function AgentAvatar({ name, provider, available, size = 38 }: AgentAvatarProps) {
  const presentation = PROVIDER_PRESENTATION[provider];
  return (
    <span
      aria-hidden="true"
      className={controlStyles.avatar}
      style={{
        width: size,
        height: size,
        fontSize: size >= 38 ? 13 : 11,
        background: presentation.background,
        color: presentation.foreground,
        boxShadow: `0 0 0 2px var(--color-surface), 0 0 0 4px ${available ? 'var(--color-success)' : '#5B6782'}`,
      }}
    >
      {buildInitials(name)}
    </span>
  );
}
