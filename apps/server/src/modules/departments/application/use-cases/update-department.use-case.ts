import { Inject, Injectable } from '@nestjs/common';
import type { Department as DepartmentDto, UpdateDepartmentRequest } from '@aiteam/contracts';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../domain/repositories/position.repository';
import { requireDepartment, toDepartmentDto } from './department-lookup';
import { assertDepartmentNameIsFree } from './department-name-uniqueness';

@Injectable()
export class UpdateDepartmentUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
  ) {}

  updateDepartment(departmentId: string, request: UpdateDepartmentRequest): DepartmentDto {
    const department = requireDepartment(this.departmentRepository, departmentId);
    if (request.name !== undefined) {
      department.rename(request.name);
      assertDepartmentNameIsFree(this.departmentRepository, department.name, departmentId);
    }
    if (request.color !== undefined) {
      department.recolor(request.color);
    }
    this.departmentRepository.updateDepartment(department);
    return toDepartmentDto(
      department,
      this.positionRepository.listPositionsByDepartment(departmentId).length,
    );
  }
}
