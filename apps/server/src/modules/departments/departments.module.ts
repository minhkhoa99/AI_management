import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AddDepartmentMemberUseCase } from './application/use-cases/add-department-member.use-case';
import { BuildOrgTreeUseCase } from './application/use-cases/build-org-tree.use-case';
import { ChangeReportingLineUseCase } from './application/use-cases/change-reporting-line.use-case';
import { CreateDepartmentUseCase } from './application/use-cases/create-department.use-case';
import { DeleteDepartmentUseCase } from './application/use-cases/delete-department.use-case';
import { ListDepartmentsUseCase } from './application/use-cases/list-departments.use-case';
import { RemoveDepartmentMemberUseCase } from './application/use-cases/remove-department-member.use-case';
import { SummarizeDepartmentsUseCase } from './application/use-cases/summarize-departments.use-case';
import { ToggleDepartmentUseCase } from './application/use-cases/toggle-department.use-case';
import { UpdateDepartmentMemberUseCase } from './application/use-cases/update-department-member.use-case';
import { UpdateDepartmentUseCase } from './application/use-cases/update-department.use-case';
import { DEPARTMENT_REPOSITORY } from './domain/repositories/department.repository';
import { POSITION_REPOSITORY } from './domain/repositories/position.repository';
import { SqliteDepartmentRepository } from './infrastructure/persistence/sqlite-department.repository';
import { SqlitePositionRepository } from './infrastructure/persistence/sqlite-position.repository';
import { DepartmentsController } from './presentation/controllers/departments.controller';

/** Departments, seats (positions) and reporting lines; members are seat + agent. */
@Module({
  imports: [AgentsModule],
  controllers: [DepartmentsController],
  providers: [
    { provide: DEPARTMENT_REPOSITORY, useClass: SqliteDepartmentRepository },
    { provide: POSITION_REPOSITORY, useClass: SqlitePositionRepository },
    ListDepartmentsUseCase,
    SummarizeDepartmentsUseCase,
    CreateDepartmentUseCase,
    UpdateDepartmentUseCase,
    DeleteDepartmentUseCase,
    ToggleDepartmentUseCase,
    BuildOrgTreeUseCase,
    AddDepartmentMemberUseCase,
    UpdateDepartmentMemberUseCase,
    ChangeReportingLineUseCase,
    RemoveDepartmentMemberUseCase,
  ],
})
export class DepartmentsModule {}
