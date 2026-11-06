'use client';

import { usePathname } from 'next/navigation';
import { StrokeIcon } from '../ui/stroke-icon';
import { findNavigationItemForPath } from './navigation-items';
import styles from './app-topbar.module.css';

const SEARCH_ICON = 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4';
const BELL_ICON = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4';
const PLUS_ICON = 'M12 5v14M5 12h14';

export function AppTopbar() {
  const screen = findNavigationItemForPath(usePathname());

  return (
    <header className={styles.topbar}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{screen.screenTitle}</h1>
        <span className={styles.subtitle}>{screen.screenSubtitle}</span>
      </div>

      <label className={styles.search}>
        <span className="visually-hidden">Tìm agent hoặc task</span>
        <span className={styles.searchIcon}>
          <StrokeIcon path={SEARCH_ICON} size={16} strokeWidth={2} />
        </span>
        <input
          type="search"
          placeholder="Tìm agent hoặc task"
          className={styles.searchInput}
          disabled
          title="Tìm kiếm có ở Giai đoạn 3"
        />
      </label>

      <button
        type="button"
        className={styles.iconButton}
        aria-label="Không có yêu cầu chờ duyệt"
        disabled
        title="Duyệt việc có ở Giai đoạn 3"
      >
        <StrokeIcon path={BELL_ICON} size={18} />
      </button>

      <button
        type="button"
        className={styles.primaryAction}
        disabled
        title="Tạo task có ở Giai đoạn 3"
      >
        <StrokeIcon path={PLUS_ICON} size={16} strokeWidth={2.2} />
        Tạo task
      </button>

      <span className={styles.avatar} role="img" aria-label="Tài khoản của bạn">
        BN
      </span>
    </header>
  );
}
