import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../../shared/errors/app-error';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../domain/repositories/position.repository';
import { requireDepartment } from './department-lookup';

@Injectable()
export class DeleteDepartmentUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
  ) {}

  /** Only an empty department can be deleted; members must be removed first. */
  deleteDepartment(departmentId: string): void {
    const department = requireDepartment(this.departmentRepository, departmentId);
    const memberCount = this.positionRepository.listPositionsByDepartment(departmentId).length;
    if (memberCount > 0) {
      throw new ConflictError(
        `Phòng "${department.name}" còn ${memberCount} thành viên. Xoá các thành viên trước.`,
        { code: 'DEPARTMENT_NOT_EMPTY' },
      );
    }
    this.departmentRepository.deleteDepartment(departmentId);
  }
}
