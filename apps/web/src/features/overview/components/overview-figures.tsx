'use client';

import type { HourlyThroughput, OverviewMetrics, ProviderUsage } from '@aiteam/contracts';
import { PROVIDER_PRESENTATION } from '../../organization/organization-labels';
import { formatCount } from '../overview-api';
import styles from './overview-figures.module.css';

const PROVIDER_COLORS = {
  claude_code: '#3B82F6',
  codex: '#34D399',
  antigravity: '#A78BFA',
  custom_api: '#F59E0B',
} as const;

function Sparkline({ values, color }: { values: ReadonlyArray<number | null>; color: string }) {
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  return (
    <span aria-hidden="true" className={styles.sparkline}>
      {values.map((value, index) => (
        <span
          key={index}
          className={styles.sparkBar}
          style={{
            height: `${Math.max(3, Math.round(((value ?? 0) / max) * 30))}px`,
            background: index === values.length - 1 ? color : '#2A3A60',
          }}
        />
      ))}
    </span>
  );
}

function describeChange(today: number, yesterday: number, unit: string): string {
  if (yesterday === 0) return today === 0 ? `Chưa có ${unit} hôm nay` : `Hôm qua chưa có ${unit}`;
  const percent = Math.round(((today - yesterday) / yesterday) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}% so với hôm qua`;
}

/** "Chỉ số chính": the 4 KPI cards with a 7-day sparkline. */
export function KpiCards({ metrics }: { metrics: OverviewMetrics }) {
  const cards = [
    {
      label: 'Task hoàn thành hôm nay',
      value: formatCount(metrics.tasksDoneToday),
      note: describeChange(metrics.tasksDoneToday, metrics.tasksDoneYesterday, 'task xong'),
      spark: metrics.tasksDoneByDay,
      color: '#34D399',
    },
    {
      label: 'Agent đang làm việc',
      value: `${metrics.agentsWorking}/${metrics.agentsEnabled}`,
      note: `${metrics.agentsTotal - metrics.agentsEnabled} agent đang tắt`,
      spark: null,
      color: '#60A5FA',
    },
    {
      label: 'Tỉ lệ qua QC hôm nay',
      value: metrics.qcPassRateToday === null ? '—' : `${metrics.qcPassRateToday}%`,
      note:
        metrics.qcPassRateToday === null ? 'QC chưa kiểm hôm nay' : 'Theo các lần QC kiểm hôm nay',
      spark: metrics.qcPassRateByDay,
      color: '#A78BFA',
    },
    {
      label: 'Token hôm nay',
      value: formatCount(metrics.tokensToday),
      note:
        metrics.apiCostTodayUsd > 0
          ? `Custom API: $${metrics.apiCostTodayUsd.toFixed(2)}`
          : describeChange(metrics.tokensToday, metrics.tokensYesterday, 'token'),
      spark: metrics.tokensByDay,
      color: '#F97316',
    },
  ];
  return (
    <section aria-label="Chỉ số chính" className={styles.kpiGrid}>
      {cards.map((card) => (
        <div key={card.label} className={styles.kpiCard}>
          <span className={styles.kpiLabel}>{card.label}</span>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{card.value}</span>
            {card.spark !== null && <Sparkline values={card.spark} color={card.color} />}
          </div>
          <span className={styles.kpiNote}>{card.note}</span>
        </div>
      ))}
    </section>
  );
}

/** "Task xử lý theo giờ": done vs reworked, today; bars are CSS with a text description. */
export function HourlyChart({ hours }: { hours: HourlyThroughput }) {
  const max = Math.max(1, ...hours.map((hour) => hour.done + hour.reworked));
  const shown = hours.slice(-12);
  const description = shown
    .map((hour) => `${hour.hour}h: ${hour.done} xong, ${hour.reworked} làm lại`)
    .join('; ');
  return (
    <section aria-label="Task theo giờ" className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h2 className={styles.cardTitle}>Task xử lý theo giờ</h2>
          <span className={styles.cardSubtitle}>Hôm nay, tất cả phòng ban</span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: '#3B82F6' }} />
            Hoàn thành
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: '#F97316' }} />
            Phải làm lại
          </span>
        </div>
      </div>
      <div className={styles.chartScroll}>
        <div role="img" aria-label={`Biểu đồ cột: ${description}`} className={styles.bars}>
          {shown.map((hour) => (
            <div key={hour.hour} className={styles.barColumn}>
              <span className={styles.barTotal}>{hour.done + hour.reworked}</span>
              <div
                className={styles.barRework}
                style={{ height: `${Math.round((hour.reworked / max) * 130)}px` }}
              />
              <div
                className={styles.barDone}
                style={{ height: `${Math.round((hour.done / max) * 130)}px` }}
              />
            </div>
          ))}
        </div>
        <div className={styles.barLabels}>
          {shown.map((hour) => (
            <span key={hour.hour}>{String(hour.hour).padStart(2, '0')}h</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Token theo bộ não": share of today's tokens per engine (money only for Custom API). */
export function ProviderUsageDonut({ usage }: { usage: ProviderUsage }) {
  const total = usage.reduce((sum, row) => sum + row.tokens, 0);
  let start = 0;
  const stops = usage.map((row) => {
    const share = total === 0 ? 0 : (row.tokens / total) * 100;
    const stop = `${PROVIDER_COLORS[row.provider]} ${start.toFixed(1)}% ${(start + share).toFixed(1)}%`;
    start += share;
    return stop;
  });
  const background = total === 0 ? '#1E2A47' : `conic-gradient(${stops.join(', ')})`;
  const description = usage
    .map((row) => `${PROVIDER_PRESENTATION[row.provider].label} ${formatCount(row.tokens)} token`)
    .join(', ');
  return (
    <section aria-label="Token theo bộ não" className={styles.donutCard}>
      <div>
        <h2 className={styles.cardTitle}>Token theo bộ não</h2>
        <span className={styles.cardSubtitle}>Hôm nay; tiền chỉ tính được cho Custom API</span>
      </div>
      <div className={styles.donutRow}>
        <div role="img" aria-label={description} className={styles.donut} style={{ background }}>
          <div className={styles.donutHole}>
            <span className={styles.donutTotal}>{formatCount(total)}</span>
            <span className={styles.cardSubtitle}>token</span>
          </div>
        </div>
        <ul className={styles.donutLegend}>
          {usage.map((row) => (
            <li key={row.provider} className={styles.donutLegendItem}>
              <span
                aria-hidden="true"
                className={styles.legendSwatch}
                style={{ background: PROVIDER_COLORS[row.provider] }}
              />
              <span className={styles.donutLegendLabel}>
                {PROVIDER_PRESENTATION[row.provider].label}
              </span>
              <span className={styles.cardSubtitle}>{row.turns} lượt</span>
              <span className={styles.donutLegendValue}>
                {row.costUsd === null ? formatCount(row.tokens) : `$${row.costUsd.toFixed(2)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
