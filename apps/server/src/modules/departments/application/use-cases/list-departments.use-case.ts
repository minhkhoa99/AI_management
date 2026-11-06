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
import { toDepartmentDto } from './department-lookup';

@Injectable()
export class ListDepartmentsUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
  ) {}

  listDepartments(): DepartmentDto[] {
    const seatCounts = this.positionRepository.countPositionsPerDepartment();
    return this.departmentRepository
      .listDepartments()
      .map((department) => toDepartmentDto(department, seatCounts.get(department.id) ?? 0));
  }
}
