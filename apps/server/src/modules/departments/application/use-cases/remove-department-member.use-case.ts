import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../../shared/errors/app-error';
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
import {
  DEPARTMENT_WORKLOAD,
  type DepartmentWorkload,
} from '../../domain/repositories/department-workload.repository';
import { requireDepartment } from './department-lookup';

/**
 * Removes the seat and its agent together. Blocked while the member has subordinates or
 * unfinished tasks (they would lose their assignee).
 */
@Injectable()
export class RemoveDepartmentMemberUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(AGENT_REPOSITORY) private readonly agentRepository: AgentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(DEPARTMENT_WORKLOAD) private readonly workload: DepartmentWorkload,
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
      const unfinishedTasks = this.workload.countUnfinishedTasksOfAgent(position.agentId);
      if (unfinishedTasks > 0) {
        throw new ConflictError(
          `Thành viên còn ${unfinishedTasks} task chưa xong. Giao các task đó cho người khác trước.`,
          { code: 'MEMBER_HAS_UNFINISHED_TASKS' },
        );
      }
      this.positionRepository.deletePosition(position.id);
      this.agentRepository.deleteAgent(position.agentId);
    });
  }
}
