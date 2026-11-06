import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail, ChangeReportingLineRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { GetAgentDetailUseCase } from '../../../agents/application/use-cases/get-agent-detail.use-case';
import { OrgChart } from '../../domain/org-chart';
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
export class ChangeReportingLineUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  changeReportingLine(
    departmentId: string,
    positionId: string,
    request: ChangeReportingLineRequest,
  ): AgentDetail {
    const agentId = this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, departmentId);
      const orgChart = new OrgChart(
        departmentId,
        this.positionRepository.listPositionsByDepartment(departmentId),
      );
      orgChart.assertCanChangeReportingLine(positionId, request.reportsToPositionId);
      const position = orgChart.requirePosition(positionId);
      this.positionRepository.updatePosition({
        ...position,
        reportsToPositionId: request.reportsToPositionId,
      });
      return position.agentId;
    });
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
