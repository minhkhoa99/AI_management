import {
  type AgentProvider,
  classifyQuotaLevel,
  type EngineQuotaReport,
  findLowestQuotaBucket,
  type LocalEngine,
  localEngineSchema,
  selectApplicableQuotaBuckets,
} from '@aiteam/contracts';
import { controlStyles } from '../../../shared/ui/controls';
import { useEngineQuotas } from '../../providers/engine-quota-store';
import { buildInitials, PROVIDER_PRESENTATION } from '../organization-labels';

function formatResetMoment(isoTimestamp: string): string {
  const moment = new Date(isoTimestamp);
  const clock = moment.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const day = String(moment.getDate()).padStart(2, '0');
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  return `${clock} ${day}/${month}`;
}

/** The warning for a local engine whose limit that applies to `model` is almost used up. */
function describeQuotaWarning(
  reports: EngineQuotaReport[] | null,
  engine: LocalEngine,
  model: string | null,
): string | null {
  const report = reports?.find((candidate) => candidate.engine === engine);
  if (report === undefined) return null;
  const lowest = findLowestQuotaBucket(selectApplicableQuotaBuckets(report, model));
  if (lowest === null || classifyQuotaLevel(lowest.remainingPercent) !== 'critical') return null;
  const resetText =
    lowest.resetsAt === null ? '' : ` · reset ${formatResetMoment(lowest.resetsAt)}`;
  return `Hạn mức ${lowest.windowLabel} của ${PROVIDER_PRESENTATION[engine].label} còn ${lowest.remainingPercent}%${resetText}`;
}

/** Only mounted for local engines with a model, so other badges never start the quota store. */
function QuotaWarningMark({ engine, model }: { engine: LocalEngine; model: string | null }) {
  const { reports } = useEngineQuotas();
  const warning = describeQuotaWarning(reports, engine, model);
  if (warning === null) return null;
  return (
    <>
      {' '}
      <span role="img" aria-label={warning} title={warning}>
        ⚠
      </span>
    </>
  );
}

export function ProviderBadge({
  provider,
  model,
}: {
  provider: AgentProvider;
  model?: string | null;
}) {
  const presentation = PROVIDER_PRESENTATION[provider];
  const engine = localEngineSchema.safeParse(provider);
  return (
    <span
      className={controlStyles.badge}
      style={{ background: presentation.background, color: presentation.foreground }}
    >
      {presentation.label}
      {model !== undefined && engine.success && (
        <QuotaWarningMark engine={engine.data} model={model} />
      )}
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
