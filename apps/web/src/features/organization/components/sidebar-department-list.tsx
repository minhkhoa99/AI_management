'use client';

import Link from 'next/link';
import { useApiQuery } from '../../../shared/api/use-api-query';
import styles from '../../../shared/layout/app-sidebar.module.css';
import { loadDepartments } from '../organization-api';
import { buildOrgHref } from '../organization-labels';

/** Department shortcuts in the sidebar, with member counts. */
export function SidebarDepartmentList() {
  const departments = useApiQuery('departments', loadDepartments);

  if (departments.status === 'loading') {
    return <p className={styles.emptyHint}>Đang tải…</p>;
  }
  if (departments.status === 'error') {
    return <p className={styles.emptyHint}>{departments.error.message}</p>;
  }
  if (departments.result.length === 0) {
    return (
      <p className={styles.emptyHint}>
        Chưa có phòng ban. <Link href="/org/">Tạo ở Sơ đồ tổ chức</Link>.
      </p>
    );
  }
  return (
    <ul className={styles.departmentList}>
      {departments.result.map((department) => (
        <li key={department.id}>
          <Link
            href={buildOrgHref(department.id)}
            className={
              department.enabled
                ? styles.departmentLink
                : `${styles.departmentLink} ${styles.departmentLinkOff}`
            }
          >
            <span
              aria-hidden="true"
              className={styles.departmentDot}
              style={{ background: department.color }}
            />
            <span className={styles.departmentName}>{department.name}</span>
            <span className={styles.departmentCount}>
              {department.agentCount} agent{department.enabled ? '' : ' · tắt'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
