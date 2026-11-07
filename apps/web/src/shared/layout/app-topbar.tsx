'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ApprovalsBell } from '../../features/tasks/components/approvals-bell';
import { StrokeIcon } from '../ui/stroke-icon';
import { findNavigationItemForPath } from './navigation-items';
import styles from './app-topbar.module.css';

const SEARCH_ICON = 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4';
const PLUS_ICON = 'M12 5v14M5 12h14';

export function AppTopbar() {
  const screen = findNavigationItemForPath(usePathname());
  const router = useRouter();

  return (
    <header className={styles.topbar}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{screen.screenTitle}</h1>
        <span className={styles.subtitle}>{screen.screenSubtitle}</span>
      </div>

      <label className={styles.search}>
        <span className="visually-hidden">Tìm task theo tiêu đề, mã hoặc người nhận</span>
        <span className={styles.searchIcon}>
          <StrokeIcon path={SEARCH_ICON} size={16} strokeWidth={2} />
        </span>
        <input
          type="search"
          placeholder="Tìm task (Enter)"
          className={styles.searchInput}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const query = event.currentTarget.value.trim();
            router.push(query === '' ? '/tasks/' : `/tasks/?q=${encodeURIComponent(query)}`);
          }}
        />
      </label>

      <ApprovalsBell buttonClassName={styles.iconButton ?? ''} />

      <Link href="/tasks/?new=1" className={styles.primaryAction}>
        <StrokeIcon path={PLUS_ICON} size={16} strokeWidth={2.2} />
        Tạo task
      </Link>

      <span className={styles.avatar} role="img" aria-label="Tài khoản của bạn">
        BN
      </span>
    </header>
  );
}
