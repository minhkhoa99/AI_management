'use client';

import Link from 'next/link';
import type { ActivityItem, Approval } from '@aiteam/contracts';
import { ApprovalActions } from '../../tasks/components/approval-actions';
import styles from './overview-figures.module.css';

const ACTIVITY_COLORS: Record<string, string> = {
  task_succeeded: '#34D399',
  step_passed: '#60A5FA',
  task_failed: '#F87171',
  step_returned: '#F97316',
  step_retried: '#F97316',
  approval_requested: '#FBBF24',
};

/** "Chờ bạn duyệt" on the overview: the same decisions as the bell. */
export function PendingApprovalsCard({ approvals }: { approvals: readonly Approval[] }) {
  return (
    <section aria-label="Chờ duyệt" className={styles.sideCard}>
      <div className={styles.chartHeader}>
        <h2 className={styles.cardTitle}>Chờ bạn duyệt</h2>
        <span className={styles.countChip}>{approvals.length}</span>
      </div>
      {approvals.length === 0 ? (
        <p className={styles.cardSubtitle}>
          Không còn yêu cầu nào. Agent sẽ hỏi bạn trước khi làm việc nhạy cảm.
        </p>
      ) : (
        approvals
          .slice(0, 3)
          .map((approval) => <ApprovalActions key={approval.id} approval={approval} />)
      )}
    </section>
  );
}

/** "Hoạt động gần đây": notable steps of every task. */
export function RecentActivityCard({ items }: { items: readonly ActivityItem[] }) {
  return (
    <section aria-label="Hoạt động gần đây" className={styles.sideCard}>
      <div className={styles.chartHeader}>
        <h2 className={styles.cardTitle}>Hoạt động gần đây</h2>
        <Link href="/tasks/" className={styles.cardSubtitle}>
          Xem các task
        </Link>
      </div>
      {items.length === 0 ? (
        <p className={styles.cardSubtitle}>Chưa có hoạt động. Tạo một task để bắt đầu.</p>
      ) : (
        <ol className={styles.activityList}>
          {items.map((item) => (
            <li key={item.id} className={styles.activityItem}>
              <span className={styles.activityRail}>
                <span
                  aria-hidden="true"
                  className={styles.activityDot}
                  style={{ background: ACTIVITY_COLORS[item.kind] ?? '#60A5FA' }}
                />
                <span aria-hidden="true" className={styles.activityLine} />
              </span>
              <span className={styles.activityText}>
                <span>
                  {item.agentName !== null && (
                    <span className={styles.activityAgent}>{item.agentName} </span>
                  )}
                  {item.text}
                </span>
                <Link
                  href={`/tasks/?task=${encodeURIComponent(item.task.id)}`}
                  className={styles.cardSubtitle}
                >
                  {item.task.code} · {item.task.title} ·{' '}
                  {new Date(item.at).toLocaleTimeString('vi', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Link>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
