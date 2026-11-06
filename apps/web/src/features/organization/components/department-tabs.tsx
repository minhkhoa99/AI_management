import type { ReactNode } from 'react';
import type { Department } from '@aiteam/contracts';
import styles from './department-tabs.module.css';

interface DepartmentTabsProps {
  departments: readonly Department[];
  selectedDepartmentId: string | undefined;
  onSelectDepartment: (departmentId: string) => void;
  /** Extra controls at the end of the tab strip (e.g. "Thêm phòng"). */
  children?: ReactNode;
}

/** Department switcher shared by the org chart, workflows and tasks screens. */
export function DepartmentTabs({
  departments,
  selectedDepartmentId,
  onSelectDepartment,
  children,
}: DepartmentTabsProps) {
  return (
    <div role="tablist" aria-label="Chọn phòng ban" className={styles.departmentTabs}>
      {departments.map((department) => (
        <button
          key={department.id}
          type="button"
          role="tab"
          aria-selected={department.id === selectedDepartmentId}
          className={styles.departmentTab}
          onClick={() => onSelectDepartment(department.id)}
        >
          <span
            aria-hidden="true"
            className={styles.colorDot}
            style={{ background: department.color }}
          />
          {department.name}
        </button>
      ))}
      {children}
    </div>
  );
}
