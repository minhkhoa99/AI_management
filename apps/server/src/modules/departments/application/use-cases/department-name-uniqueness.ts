import { ConflictError } from '../../../../shared/errors/app-error';
import type { DepartmentRepository } from '../../domain/repositories/department.repository';

/** Names compare with Vietnamese case rules (the SQL index only folds ASCII). */
export function assertDepartmentNameIsFree(
  departmentRepository: DepartmentRepository,
  candidateName: string,
  ignoredDepartmentId?: string,
): void {
  const clash = departmentRepository
    .listDepartments()
    .find(
      (department) =>
        department.id !== ignoredDepartmentId && department.hasSameNameAs(candidateName),
    );
  if (clash !== undefined) {
    throw new ConflictError(`Đã có phòng tên "${clash.name}".`, { code: 'DEPARTMENT_NAME_TAKEN' });
  }
}
