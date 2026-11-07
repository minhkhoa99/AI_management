'use client';

import Link from 'next/link';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { useEventStream } from '../../../shared/api/use-event-stream';
import { controlStyles, StatusNotice } from '../../../shared/ui/controls';
import { loadAgents, loadDepartmentSummaries } from '../../organization/organization-api';
import { loadPendingApprovals } from '../../tasks/tasks-api';
import {
  loadHourlyThroughput,
  loadOverviewMetrics,
  loadRecentActivity,
  loadUsageByProvider,
} from '../overview-api';
import { AgentTable } from './agent-table';
import { HourlyChart, KpiCards, ProviderUsageDonut } from './overview-figures';
import figureStyles from './overview-figures.module.css';
import { PendingApprovalsCard, RecentActivityCard } from './overview-side-cards';
import { DepartmentCards } from './department-cards';
import styles from './overview.module.css';

/** Overview: KPIs, hourly chart, tokens per engine, approvals, recent activity, agents. */
export function OverviewScreen() {
  const summaries = useApiQuery('departments:summary', loadDepartmentSummaries);
  const agents = useApiQuery('agents:all', () => loadAgents());
  const metrics = useApiQuery('overview:metrics', loadOverviewMetrics);
  const throughput = useApiQuery('overview:throughput', loadHourlyThroughput);
  const usage = useApiQuery('overview:usage', loadUsageByProvider);
  const activity = useApiQuery('overview:activity', () => loadRecentActivity());
  const approvals = useApiQuery('approvals:pending', loadPendingApprovals);
  // Figures follow the work live: any task or approval change refreshes them.
  useEventStream('/api/stream/workspace', (updates) => {
    metrics.reload();
    throughput.reload();
    usage.reload();
    activity.reload();
    if (updates.some((update) => update.type === 'approval.changed')) approvals.reload();
  });

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
      {metrics.status === 'success' && <KpiCards metrics={metrics.result} />}
      <div className={figureStyles.figureRow}>
        <div className={figureStyles.mainColumn}>
          <div className={figureStyles.figureRow}>
            {throughput.status === 'success' && <HourlyChart hours={throughput.result} />}
            {usage.status === 'success' && <ProviderUsageDonut usage={usage.result} />}
          </div>
          <AgentTable agents={agents.result} departments={summaries.result} />
        </div>
        <div className={figureStyles.sideColumn}>
          <PendingApprovalsCard
            approvals={approvals.status === 'success' ? approvals.result : []}
          />
          {activity.status === 'success' && <RecentActivityCard items={activity.result} />}
        </div>
      </div>
      <DepartmentCards summaries={summaries.result} />
    </>
  );
}
