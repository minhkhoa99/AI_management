'use client';

import { useState } from 'react';
import type { Approval } from '@aiteam/contracts';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { decideApproval } from '../tasks-api';
import styles from './tasks.module.css';

/** One approval request: what is asked (agent text, shown as plain text) and the decision. */
export function ApprovalActions({ approval }: { approval: Approval }) {
  const [note, setNote] = useState('');
  const { outcome, isPending, performAction } = useActionOutcome();
  const decide = (approved: boolean) =>
    void performAction(
      () => decideApproval(approval.id, approved, note),
      () => (approved ? 'Đã duyệt.' : 'Đã từ chối.'),
    );

  return (
    <div className={styles.approvalBox}>
      <span className={styles.approvalTitle}>
        {approval.kind === 'sensitive_action' ? 'Việc nhạy cảm cần duyệt' : 'Duyệt bước'} ·{' '}
        {approval.task.code}
      </span>
      <span className={styles.factValue}>{approval.summary}</span>
      <p className={styles.approvalRequest}>{approval.request}</p>
      <label className={controlStyles.field}>
        Ghi chú cho agent (không bắt buộc)
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={controlStyles.fieldInput}
        />
      </label>
      <StatusNotice outcome={outcome} />
      <div className={controlStyles.buttonRow}>
        <button
          type="button"
          className={controlStyles.primaryButton}
          disabled={isPending}
          onClick={() => decide(true)}
        >
          Duyệt
        </button>
        <button
          type="button"
          className={controlStyles.dangerButton}
          disabled={isPending}
          onClick={() => decide(false)}
        >
          Từ chối
        </button>
      </div>
    </div>
  );
}
