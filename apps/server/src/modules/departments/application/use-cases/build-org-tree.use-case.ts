import { Inject, Injectable } from '@nestjs/common';
import type { AgentSummary, OrgTree, OrgTreeNode } from '@aiteam/contracts';
import {
  AGENT_DIRECTORY_QUERY,
  type AgentDirectoryQuery,
} from '../../../agents/application/ports/agent-directory.query';
import { OrgChart, type OrgChartBranch } from '../../domain/org-chart';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '../../domain/repositories/position.repository';
import { requireDepartment, toDepartmentDto } from './department-lookup';

@Injectable()
export class BuildOrgTreeUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(POSITION_REPOSITORY) private readonly positionRepository: PositionRepository,
    @Inject(AGENT_DIRECTORY_QUERY) private readonly agentDirectory: AgentDirectoryQuery,
  ) {}

  buildOrgTree(departmentId: string): OrgTree {
    const department = requireDepartment(this.departmentRepository, departmentId);
    const positions = this.positionRepository.listPositionsByDepartment(departmentId);
    const agents = this.agentDirectory.listAgentSummaries({ departmentId });
    const agentByPositionId = new Map(agents.map((agent) => [agent.positionId, agent]));
    // Siblings keep the order in which members joined.
    const joinOrder = new Map(agents.map((agent, index) => [agent.id, index]));

    const tree = new OrgChart(departmentId, positions).buildTree(
      (position) => agentByPositionId.get(position.id) as AgentSummary,
      (left, right) => (joinOrder.get(left.id) ?? 0) - (joinOrder.get(right.id) ?? 0),
    );
    return {
      department: toDepartmentDto(department, positions.length),
      root: tree === null ? null : toOrgTreeNode(tree),
    };
  }
}

function toOrgTreeNode(branch: OrgChartBranch<AgentSummary>): OrgTreeNode {
  return {
    positionId: branch.position.id,
    agent: branch.payload,
    children: branch.children.map(toOrgTreeNode),
  };
}
