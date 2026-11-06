import { Inject, Injectable } from '@nestjs/common';
import type { AgentDetail, UpdateDepartmentMemberRequest } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { createAgentNotFoundError } from '../../../agents/application/use-cases/agent-not-found.error';
import { GetAgentDetailUseCase } from '../../../agents/application/use-cases/get-agent-detail.use-case';
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

/** Renames a member and/or changes their role; the seat title follows the role. */
@Injectable()
export class UpdateDepartmentMemberUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  updateDepartmentMember(
    departmentId: string,
    positionId: string,
    request: UpdateDepartmentMemberRequest,
  ): AgentDetail {
    const agentId = this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, departmentId);
      const position = new OrgChart(
        departmentId,
        this.positionRepository.listPositionsByDepartment(departmentId),
      ).requirePosition(positionId);
      const agent = this.agentRepository.findAgentById(position.agentId);
      if (agent === undefined) {
        throw createAgentNotFoundError();
      }
      if (request.name !== undefined) {
        agent.rename(request.name);
      }
      if (request.role !== undefined) {
        agent.changeRole(request.role);
        this.positionRepository.updatePosition({ ...position, title: request.role });
      }
      this.agentRepository.updateAgent(agent);
      return agent.id;
    });
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
