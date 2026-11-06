import type { Department } from '../entities/department';

export const DEPARTMENT_REPOSITORY = Symbol('DEPARTMENT_REPOSITORY');

export interface DepartmentRepository {
  listDepartments(): Department[];
  findDepartmentById(departmentId: string): Department | undefined;
  insertDepartment(department: Department): void;
  updateDepartment(department: Department): void;
  deleteDepartment(departmentId: string): void;
}
