import { Inject, Injectable } from '@nestjs/common';
import type { CreateDepartmentRequest, Department as DepartmentDto } from '@aiteam/contracts';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import { Department } from '../../domain/entities/department';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import { toDepartmentDto } from './department-lookup';
import { assertDepartmentNameIsFree } from './department-name-uniqueness';

@Injectable()
export class CreateDepartmentUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  createDepartment(request: CreateDepartmentRequest): DepartmentDto {
    const department = Department.createNew({
      id: this.idGenerator.generateId(),
      name: request.name,
      color: request.color,
    });
    assertDepartmentNameIsFree(this.departmentRepository, department.name);
    this.departmentRepository.insertDepartment(department);
    return toDepartmentDto(department, 0);
  }
}
