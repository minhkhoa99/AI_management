'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { healthResponseSchema } from '@aiteam/contracts';
import { fetchApiJson } from '../api/api-client';
import { useApiQuery } from '../api/use-api-query';
import { useEventStream } from '../api/use-event-stream';
import { formatCount, loadUsageToday } from '../../features/overview/overview-api';
import { EngineQuotaCard } from '../../features/providers/components/engine-quota-card';
import { SidebarDepartmentList } from '../../features/organization/components/sidebar-department-list';
import { StrokeIcon } from '../ui/stroke-icon';
import { findNavigationItemForPath, NAVIGATION_ITEMS } from './navigation-items';
import styles from './app-sidebar.module.css';

export function AppSidebar() {
  const pathname = usePathname();
  const activeItem = findNavigationItemForPath(pathname);

  return (
    <nav aria-label="Điều hướng chính" className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <StrokeIcon path="M9 2h6v5H9zM2 17h6v5H2zM16 17h6v5h-6zM12 7v5M5 17v-3h14v3" size={20} />
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>AI Team</span>
          <span className={styles.brandCaption}>Không gian làm việc của bạn</span>
        </span>
      </div>

      <ul className={styles.navList}>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive = item === activeItem;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              >
                <StrokeIcon path={item.iconPath} size={18} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="sidebar-departments" className={styles.departments}>
        <h2 id="sidebar-departments" className={styles.sectionLabel}>
          Phòng ban
        </h2>
        <SidebarDepartmentList />
      </section>

      <div className={styles.sidebarFooter}>
        <EngineQuotaCard />
        <UsageTodayCard />
        <ServerStatusCard />
      </div>
    </nav>
  );
}

/** "Hạn mức hôm nay": tokens and turns used today (no budget limit: postponed in phase 5). */
function UsageTodayCard() {
  const usage = useApiQuery('overview:usage-today', loadUsageToday);
  useEventStream('/api/stream/workspace', (updates) => {
    if (updates.some((update) => update.type === 'task.changed')) usage.reload();
  });
  if (usage.status !== 'success') return null;
  return (
    <div className={styles.statusCard}>
      <span className={styles.sectionLabel}>Hạn mức hôm nay</span>
      <span className={styles.usageValue}>{formatCount(usage.result.tokens)} token</span>
      <span className={styles.statusText}>{usage.result.turns} lượt agent</span>
    </div>
  );
}

function ServerStatusCard() {
  const health = useApiQuery('health', () => fetchApiJson('/api/health', healthResponseSchema));

  return (
    <div className={styles.statusCard} role="status" aria-live="polite">
      <span className={styles.sectionLabel}>Máy chủ cục bộ</span>
      {health.status === 'loading' && <span className={styles.statusText}>Đang kiểm tra…</span>}
      {health.status === 'success' && (
        <span className={styles.statusText}>
          <span aria-hidden="true" className={`${styles.statusDot} ${styles.statusDotOk}`} />
          Hoạt động · v{health.result.version}
        </span>
      )}
      {health.status === 'error' && (
        <span className={styles.statusText}>
          <span aria-hidden="true" className={`${styles.statusDot} ${styles.statusDotError}`} />
          Mất kết nối.{' '}
          <button type="button" className={styles.retryButton} onClick={health.reload}>
            Thử lại
          </button>
        </span>
      )}
    </div>
  );
}
