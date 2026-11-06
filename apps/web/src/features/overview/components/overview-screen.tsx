'use client';

import Link from 'next/link';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { loadAgents, loadDepartmentSummaries } from '../../organization/organization-api';
import { AgentTable } from './agent-table';
import { DepartmentCards } from './department-cards';
import styles from './overview.module.css';

/** Phase 1 overview: department cards and the agent table. KPIs and charts arrive in phase 4. */
export function OverviewScreen() {
  const summaries = useApiQuery('departments:summary', loadDepartmentSummaries);
  const agents = useApiQuery('agents:all', () => loadAgents());

  if (summaries.status === 'error' || agents.status === 'error') {
    const error =
      summaries.status === 'error' ? summaries.error : (agents as { error: Error }).error;
    return <StatusNotice outcome={{ tone: 'error', error }} />;
  }
  if (summaries.status === 'loading' || agents.status === 'loading') {
    return <p className={styles.loadingText}>Đang tải…</p>;
  }
  if (summaries.result.length === 0) {
    return (
      <section className={controlStyles.panel} aria-label="Bắt đầu">
        <h2 className={controlStyles.panelTitle}>Chưa có phòng ban</h2>
        <p className={styles.loadingText}>
          Bắt đầu bằng việc tạo phòng ban và thêm agent trong Sơ đồ tổ chức.
        </p>
        <div className={controlStyles.buttonRow}>
          <Link href="/org/" className={controlStyles.primaryButton + ' ' + styles.buttonLink}>
            Mở Sơ đồ tổ chức
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <AgentTable agents={agents.result} departments={summaries.result} />
      <DepartmentCards summaries={summaries.result} />
    </>
  );
}
