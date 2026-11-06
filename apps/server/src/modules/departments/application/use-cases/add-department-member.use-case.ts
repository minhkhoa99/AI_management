import { Inject, Injectable } from '@nestjs/common';
import type { AddDepartmentMemberRequest, AgentDetail } from '@aiteam/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { ID_GENERATOR, type IdGenerator } from '../../../../shared/identifiers/id-generator';
import {
  PROVIDER_CONNECTION_LOOKUP,
  type ProviderConnectionLookup,
} from '../../../agents/application/ports/provider-connection-lookup.port';
import { GetAgentDetailUseCase } from '../../../agents/application/use-cases/get-agent-detail.use-case';
import { Agent } from '../../../agents/domain/entities/agent';
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

/** Creates the agent and its seat in one transaction (a member is always seat + agent). */
@Injectable()
export class AddDepartmentMemberUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(PROVIDER_CONNECTION_LOOKUP)
    private readonly providerConnectionLookup: ProviderConnectionLookup,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
  ) {}

  addDepartmentMember(departmentId: string, request: AddDepartmentMemberRequest): AgentDetail {
    const agentId = this.transactionRunner.runInTransaction(() => {
      requireDepartment(this.departmentRepository, departmentId);
      const orgChart = new OrgChart(
        departmentId,
        this.positionRepository.listPositionsByDepartment(departmentId),
      );
      orgChart.assertCanAttachNewMember(request.reportsToPositionId);

      const agent = Agent.createNew({
        id: this.idGenerator.generateId(),
        name: request.name,
        role: request.role,
        provider: request.provider,
        connectionId: request.connectionId,
        model: request.model,
      });
      const connectionId = agent.toState().connectionId;
      if (connectionId !== null && !this.providerConnectionLookup.connectionExists(connectionId)) {
        throw new NotFoundError('Không tìm thấy kết nối API đã chọn.', {
          code: 'CONNECTION_NOT_FOUND',
        });
      }

      this.agentRepository.insertAgent(agent);
      this.positionRepository.insertPosition({
        id: this.idGenerator.generateId(),
        departmentId,
        title: agent.role,
        reportsToPositionId: request.reportsToPositionId,
        agentId: agent.id,
      });
      return agent.id;
    });
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }
}
