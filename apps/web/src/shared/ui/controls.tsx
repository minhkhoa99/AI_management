import type { ReactNode } from 'react';
import { ApiRequestError } from '../api/api-client';
import styles from './controls.module.css';

interface ToggleSwitchProps {
  pressed: boolean;
  /** Accessible name describing what pressing does, e.g. "Tắt Dev backend". */
  accessibleLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  visibleLabel?: string;
}

/** On/off switch as a real button with aria-pressed. */
export function ToggleSwitch({
  pressed,
  accessibleLabel,
  onToggle,
  disabled = false,
  visibleLabel,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      className={styles.toggleButton}
      aria-pressed={pressed}
      aria-label={visibleLabel === undefined ? accessibleLabel : undefined}
      title={accessibleLabel}
      onClick={onToggle}
      disabled={disabled}
    >
      <span
        className={pressed ? `${styles.toggleTrack} ${styles.toggleTrackOn}` : styles.toggleTrack}
      >
        <span className={styles.toggleKnob} />
      </span>
      {visibleLabel}
    </button>
  );
}

interface StatusPillProps {
  available: boolean;
}

/** Status is always written out, never colour alone. */
export function StatusPill({ available }: StatusPillProps) {
  return (
    <span
      className={`${styles.statusPill} ${available ? styles.statusPillAvailable : styles.statusPillOff}`}
    >
      <span
        aria-hidden="true"
        className={styles.statusDot}
        style={{ background: available ? 'var(--color-success)' : '#5B6782' }}
      />
      {available ? 'Sẵn sàng' : 'Đã tắt'}
    </span>
  );
}

interface StatusNoticeProps {
  outcome: { tone: 'success'; message: string } | { tone: 'error'; error: unknown } | null;
}

/** Result of the last action; errors show the traceId to look up in the server log. */
export function StatusNotice({ outcome }: StatusNoticeProps) {
  if (outcome === null) {
    return null;
  }
  if (outcome.tone === 'success') {
    return (
      <p role="status" className={`${styles.notice} ${styles.noticeSuccess}`}>
        {outcome.message}
      </p>
    );
  }
  const error = outcome.error;
  const message = error instanceof Error ? error.message : 'Đã có lỗi không xác định.';
  const traceId = error instanceof ApiRequestError ? error.traceId : null;
  return (
    <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>
      {message}
      {traceId !== null && <span className={styles.noticeTrace}>Mã tra cứu: {traceId}</span>}
    </p>
  );
}

interface InlinePanelProps {
  title: string;
  emphasised?: boolean;
  children: ReactNode;
}

/** In-page panel used instead of modal dialogs (forms, confirmations). */
export function InlinePanel({ title, emphasised = false, children }: InlinePanelProps) {
  return (
    <section
      aria-label={title}
      className={emphasised ? `${styles.panel} ${styles.panelEmphasis}` : styles.panel}
    >
      <h2 className={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  );
}

export { styles as controlStyles };
