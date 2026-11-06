import { Inject, Injectable } from '@nestjs/common';
import type { Department as DepartmentDto } from '@aiteam/contracts';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../domain/repositories/position.repository';
import { requireDepartment, toDepartmentDto } from './department-lookup';

/**
 * Turning a department off keeps each agent's own on/off flag: switching the department back on
 * restores exactly the previous state. An agent is available only when both are on.
 */
@Injectable()
export class ToggleDepartmentUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
  ) {}

  toggleDepartment(departmentId: string, enabled: boolean): DepartmentDto {
    const department = requireDepartment(this.departmentRepository, departmentId);
    department.setEnabled(enabled);
    this.departmentRepository.updateDepartment(department);
    return toDepartmentDto(
      department,
      this.positionRepository.listPositionsByDepartment(departmentId).length,
    );
  }
}
