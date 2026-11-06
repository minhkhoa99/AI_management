import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  type AddDepartmentMemberRequest,
  addDepartmentMemberRequestSchema,
  type AgentDetail,
  type ChangeReportingLineRequest,
  changeReportingLineRequestSchema,
  type CreateDepartmentRequest,
  createDepartmentRequestSchema,
  type Department,
  type DepartmentSummary,
  entityIdSchema,
  type OrgTree,
  type SetEnabledRequest,
  setEnabledRequestSchema,
  type UpdateDepartmentMemberRequest,
  updateDepartmentMemberRequestSchema,
  type UpdateDepartmentRequest,
  updateDepartmentRequestSchema,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { AddDepartmentMemberUseCase } from '../../application/use-cases/add-department-member.use-case';
import { BuildOrgTreeUseCase } from '../../application/use-cases/build-org-tree.use-case';
import { ChangeReportingLineUseCase } from '../../application/use-cases/change-reporting-line.use-case';
import { CreateDepartmentUseCase } from '../../application/use-cases/create-department.use-case';
import { DeleteDepartmentUseCase } from '../../application/use-cases/delete-department.use-case';
import { ListDepartmentsUseCase } from '../../application/use-cases/list-departments.use-case';
import { RemoveDepartmentMemberUseCase } from '../../application/use-cases/remove-department-member.use-case';
import { SummarizeDepartmentsUseCase } from '../../application/use-cases/summarize-departments.use-case';
import { ToggleDepartmentUseCase } from '../../application/use-cases/toggle-department.use-case';
import { UpdateDepartmentMemberUseCase } from '../../application/use-cases/update-department-member.use-case';
import { UpdateDepartmentUseCase } from '../../application/use-cases/update-department.use-case';

const departmentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã phòng ban');
const positionIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã thành viên');

@Controller('api/departments')
export class DepartmentsController {
  constructor(
    private readonly listDepartmentsUseCase: ListDepartmentsUseCase,
    private readonly summarizeDepartmentsUseCase: SummarizeDepartmentsUseCase,
    private readonly createDepartmentUseCase: CreateDepartmentUseCase,
    private readonly updateDepartmentUseCase: UpdateDepartmentUseCase,
    private readonly deleteDepartmentUseCase: DeleteDepartmentUseCase,
    private readonly toggleDepartmentUseCase: ToggleDepartmentUseCase,
    private readonly buildOrgTreeUseCase: BuildOrgTreeUseCase,
    private readonly addDepartmentMemberUseCase: AddDepartmentMemberUseCase,
    private readonly updateDepartmentMemberUseCase: UpdateDepartmentMemberUseCase,
    private readonly changeReportingLineUseCase: ChangeReportingLineUseCase,
    private readonly removeDepartmentMemberUseCase: RemoveDepartmentMemberUseCase,
  ) {}

  @Get()
  listDepartments(): Department[] {
    return this.listDepartmentsUseCase.listDepartments();
  }

  @Get('summary')
  summarizeDepartments(): DepartmentSummary[] {
    return this.summarizeDepartmentsUseCase.summarizeDepartments();
  }

  @Post()
  createDepartment(
    @Body(new ZodRequestPipe(createDepartmentRequestSchema)) request: CreateDepartmentRequest,
  ): Department {
    return this.createDepartmentUseCase.createDepartment(request);
  }

  @Patch(':departmentId')
  updateDepartment(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(updateDepartmentRequestSchema)) request: UpdateDepartmentRequest,
  ): Department {
    return this.updateDepartmentUseCase.updateDepartment(departmentId, request);
  }

  @Delete(':departmentId')
  @HttpCode(204)
  deleteDepartment(@Param('departmentId', departmentIdPipe) departmentId: string): void {
    this.deleteDepartmentUseCase.deleteDepartment(departmentId);
  }

  @Patch(':departmentId/enabled')
  toggleDepartment(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(setEnabledRequestSchema)) request: SetEnabledRequest,
  ): Department {
    return this.toggleDepartmentUseCase.toggleDepartment(departmentId, request.enabled);
  }

  @Get(':departmentId/org-tree')
  buildOrgTree(@Param('departmentId', departmentIdPipe) departmentId: string): OrgTree {
    return this.buildOrgTreeUseCase.buildOrgTree(departmentId);
  }

  @Post(':departmentId/members')
  addDepartmentMember(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Body(new ZodRequestPipe(addDepartmentMemberRequestSchema)) request: AddDepartmentMemberRequest,
  ): AgentDetail {
    return this.addDepartmentMemberUseCase.addDepartmentMember(departmentId, request);
  }

  @Patch(':departmentId/members/:positionId')
  updateDepartmentMember(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Param('positionId', positionIdPipe) positionId: string,
    @Body(new ZodRequestPipe(updateDepartmentMemberRequestSchema))
    request: UpdateDepartmentMemberRequest,
  ): AgentDetail {
    return this.updateDepartmentMemberUseCase.updateDepartmentMember(
      departmentId,
      positionId,
      request,
    );
  }

  @Put(':departmentId/members/:positionId/reports-to')
  changeReportingLine(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Param('positionId', positionIdPipe) positionId: string,
    @Body(new ZodRequestPipe(changeReportingLineRequestSchema)) request: ChangeReportingLineRequest,
  ): AgentDetail {
    return this.changeReportingLineUseCase.changeReportingLine(departmentId, positionId, request);
  }

  @Delete(':departmentId/members/:positionId')
  @HttpCode(204)
  removeDepartmentMember(
    @Param('departmentId', departmentIdPipe) departmentId: string,
    @Param('positionId', positionIdPipe) positionId: string,
  ): void {
    this.removeDepartmentMemberUseCase.removeDepartmentMember(departmentId, positionId);
  }
}
