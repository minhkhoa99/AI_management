import { Inject, Injectable } from '@nestjs/common';
import type { Department as DepartmentDto, TeamMode } from '@aiteam/contracts';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../domain/repositories/position.repository';
import { requireDepartment, toDepartmentDto } from './department-lookup';

/** How the department's work is coordinated; only the built-in orchestrator runs today. */
@Injectable()
export class ChangeTeamModeUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
  ) {}

  changeTeamMode(departmentId: string, teamMode: TeamMode): DepartmentDto {
    const department = requireDepartment(this.departmentRepository, departmentId);
    department.changeTeamMode(teamMode);
    this.departmentRepository.updateDepartment(department);
    return toDepartmentDto(
      department,
      this.positionRepository.listPositionsByDepartment(departmentId).length,
    );
  }
}
