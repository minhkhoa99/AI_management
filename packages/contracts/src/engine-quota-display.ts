import {
  classifyQuotaLevel,
  findLowestQuotaBucket,
  type EngineQuotaBucket,
  type EngineQuotaReport,
} from './engine-quota';

export interface EngineQuotaDescription {
  headline: string;
  level: 'normal' | 'warning' | 'critical' | 'muted';
  percent: number | null;
}

const NO_PLAN_LIMIT = 'không có hạn mức theo gói';

function formatClock(moment: Date): string {
  return moment.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDayMonth(moment: Date): string {
  const day = String(moment.getDate()).padStart(2, '0');
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function isSameLocalDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function describeBucket(bucket: EngineQuotaBucket, now: Date): string {
  const base = `${bucket.remainingPercent}% · ${bucket.windowLabel}`;
  if (bucket.resetsAt === null) return base;
  const resetMoment = new Date(bucket.resetsAt);
  const dayPart = isSameLocalDay(resetMoment, now) ? '' : ` ${formatDayMonth(resetMoment)}`;
  return `${base} · reset ${formatClock(resetMoment)}${dayPart}`;
}

/** One-line summary of an engine's quota for the sidebar; pure so it can be tested here. */
export function describeEngineQuota(report: EngineQuotaReport, now: Date): EngineQuotaDescription {
  const lowest = findLowestQuotaBucket(report.buckets);
  switch (report.state) {
    case 'ok':
      if (lowest === null) return { headline: NO_PLAN_LIMIT, level: 'muted', percent: null };
      return {
        headline: describeBucket(lowest, now),
        level: classifyQuotaLevel(lowest.remainingPercent),
        percent: lowest.remainingPercent,
      };
    case 'not_signed_in':
      return { headline: '⚠ chưa đăng nhập', level: 'critical', percent: null };
    case 'not_installed':
      return { headline: 'chưa cài', level: 'muted', percent: null };
    case 'not_applicable':
      return { headline: NO_PLAN_LIMIT, level: 'muted', percent: null };
    case 'unreadable':
      if (report.checkedAt === null)
        return { headline: 'đang đọc…', level: 'muted', percent: null };
      if (lowest !== null && report.lastSuccessAt !== null) {
        return {
          headline: `không đọc được hạn mức · số lúc ${formatClock(new Date(report.lastSuccessAt))}`,
          level: 'muted',
          percent: lowest.remainingPercent,
        };
      }
      return { headline: 'không đọc được hạn mức', level: 'muted', percent: null };
  }
}

/** `HH:mm dd/MM` in the machine's local time zone (the server and the UI share one machine). */
export function formatQuotaResumeTime(iso: string): string {
  const moment = new Date(iso);
  return `${formatClock(moment)} ${formatDayMonth(moment)}`;
}
