'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { useEventStream } from '../../../shared/api/use-event-stream';
import { StrokeIcon } from '../../../shared/ui/stroke-icon';
import { loadPendingApprovals } from '../tasks-api';
import { ApprovalActions } from './approval-actions';
import styles from './tasks.module.css';

const BELL_ICON = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4';

/** Top bar bell: requests waiting for the user, decided right from the list. */
export function ApprovalsBell({ buttonClassName }: { buttonClassName: string }) {
  const approvals = useApiQuery('approvals:pending', loadPendingApprovals);
  const [isOpen, setIsOpen] = useState(false);
  useEventStream('/api/stream/workspace', (updates) => {
    if (updates.some((update) => update.type === 'approval.changed')) approvals.reload();
  });
  const pending = approvals.status === 'success' ? approvals.result : [];

  return (
    <div className={styles.bellWrapper}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={
          pending.length === 0
            ? 'Không có yêu cầu chờ duyệt'
            : `${pending.length} yêu cầu chờ duyệt`
        }
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <StrokeIcon path={BELL_ICON} size={18} />
        {pending.length > 0 && <span className={styles.bellBadge}>{pending.length}</span>}
      </button>
      {isOpen && (
        <section aria-label="Chờ bạn duyệt" className={styles.bellPanel}>
          <h2 className={styles.bellTitle}>Chờ bạn duyệt</h2>
          {pending.length === 0 && <p className={styles.hint}>Không có yêu cầu nào.</p>}
          {pending.map((approval) => (
            <div key={approval.id} className={styles.formStack}>
              <ApprovalActions approval={approval} />
              <Link
                href={`/tasks/?task=${encodeURIComponent(approval.task.id)}`}
                className={styles.bellLink}
                onClick={() => setIsOpen(false)}
              >
                Mở task {approval.task.code}: {approval.task.title}
              </Link>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
