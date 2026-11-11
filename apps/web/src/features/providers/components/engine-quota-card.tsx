'use client';

import { describeEngineQuota, type EngineQuotaReport } from '@aiteam/contracts';
import { PROVIDER_PRESENTATION } from '../../organization/organization-labels';
import { useEngineQuotas } from '../engine-quota-store';
import styles from './engine-quota-card.module.css';

type QuotaLevel = ReturnType<typeof describeEngineQuota>['level'];

const LEVEL_CLASS: Record<QuotaLevel, string> = {
  normal: styles.levelNormal ?? '',
  warning: styles.levelWarning ?? '',
  critical: styles.levelCritical ?? '',
  muted: styles.levelMuted ?? '',
};

/** Short name for a narrow sidebar. */
const ENGINE_MARK = { claude_code: 'CC', codex: 'CX', antigravity: 'AG' } as const;

function describeBucketLine(report: EngineQuotaReport, bucketIndex: number, now: Date): string {
  const bucket = report.buckets[bucketIndex];
  if (bucket === undefined) return '';
  const line = describeEngineQuota({ ...report, state: 'ok', buckets: [bucket] }, now).headline;
  return bucket.group === null ? line : `${bucket.group} · ${line}`;
}

function describeAge(reports: EngineQuotaReport[], now: number): string {
  const checkedTimes = reports.flatMap((report) =>
    report.checkedAt === null ? [] : [Date.parse(report.checkedAt)],
  );
  if (checkedTimes.length === 0) return 'đang đọc…';
  const minutes = Math.max(0, Math.floor((now - Math.max(...checkedTimes)) / 60_000));
  return `cập nhật ${minutes} phút trước`;
}

function EngineQuotaRow({ report, now }: { report: EngineQuotaReport; now: number }) {
  const presentation = PROVIDER_PRESENTATION[report.engine];
  const description = describeEngineQuota(report, new Date(now));
  const hasBuckets = report.state === 'ok' && report.buckets.length > 1;
  const summary = (
    <>
      <span className={styles.rowHead}>
        <span className={`${styles.levelDot} ${LEVEL_CLASS[description.level]}`} aria-hidden />
        <span className={styles.engineName} title={presentation.label}>
          <span className={styles.engineMark} aria-hidden>
            {ENGINE_MARK[report.engine]}
          </span>
          <span className={styles.engineLabel}>{presentation.label}</span>
        </span>
      </span>
      <span className={styles.headline}>{description.headline}</span>
      {description.percent !== null && (
        <span className={styles.track} aria-hidden>
          <span
            className={`${styles.fill} ${LEVEL_CLASS[description.level]}`}
            style={{
              width: `${description.percent}%`,
              ...(description.level === 'normal' ? { background: presentation.foreground } : {}),
            }}
          />
        </span>
      )}
    </>
  );

  if (!hasBuckets) return <li className={styles.row}>{summary}</li>;
  return (
    <li className={styles.row}>
      <details className={styles.details}>
        <summary className={styles.summary}>{summary}</summary>
        <ul className={styles.bucketList}>
          {report.buckets.map((bucket, index) => (
            <li key={`${bucket.group ?? ''}|${bucket.window}`} className={styles.bucketItem}>
              {describeBucketLine(report, index, new Date(now))}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** "Hạn mức còn lại": plan usage limits of the local engines, one row per engine. */
export function EngineQuotaCard() {
  const { reports, refresh, refreshing, now } = useEngineQuotas();
  if (reports === null || reports.length === 0) return null;
  const clock = now === 0 ? Date.now() : now;
  return (
    <div className={styles.card}>
      <span className={styles.title}>Hạn mức còn lại</span>
      <ul className={styles.list}>
        {reports.map((report) => (
          <EngineQuotaRow key={report.engine} report={report} now={clock} />
        ))}
      </ul>
      <div className={styles.footer}>
        <span>{describeAge(reports, clock)}</span>
        <button
          type="button"
          className={styles.refreshButton}
          aria-label="Đọc lại hạn mức"
          disabled={refreshing}
          onClick={refresh}
        >
          ↻
        </button>
      </div>
    </div>
  );
}
