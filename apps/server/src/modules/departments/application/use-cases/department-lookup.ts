import type { Department as DepartmentDto } from '@aiteam/contracts';
import { NotFoundError } from '../../../../shared/errors/app-error';
import type { Department } from '../../domain/entities/department';
import type { DepartmentRepository } from '../../domain/repositories/department.repository';

export function requireDepartment(
  departmentRepository: DepartmentRepository,
  departmentId: string,
): Department {
  const department = departmentRepository.findDepartmentById(departmentId);
  if (department === undefined) {
    throw new NotFoundError('Không tìm thấy phòng ban.', { code: 'DEPARTMENT_NOT_FOUND' });
  }
  return department;
}

export function toDepartmentDto(department: Department, agentCount: number): DepartmentDto {
  const state = department.toState();
  return {
    id: state.id,
    name: state.name,
    color: state.color,
    enabled: state.enabled,
    teamMode: state.teamMode,
    agentCount,
  };
}
