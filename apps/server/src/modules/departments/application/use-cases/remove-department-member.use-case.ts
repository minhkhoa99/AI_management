import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import {
  AGENT_REPOSITORY,
  type AgentRepository,
} from '../../../agents/domain/repositories/agent.repository';
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

/** Removes the seat and its agent together. Blocked while the member has subordinates. */
@Injectable()
export class RemoveDepartmentMemberUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {}

  removeDepartmentMember(departmentId: string, positionId: string): void {
    this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, departmentId);
      const orgChart = new OrgChart(
        departmentId,
        this.positionRepository.listPositionsByDepartment(departmentId),
      );
      orgChart.assertCanRemoveMember(positionId);
      const position = orgChart.requirePosition(positionId);
      this.positionRepository.deletePosition(position.id);
      this.agentRepository.deleteAgent(position.agentId);
    });
  }
}
