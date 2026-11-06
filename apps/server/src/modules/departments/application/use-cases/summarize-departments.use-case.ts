import { Inject, Injectable } from '@nestjs/common';
import type { AgentSummary, DepartmentSummary } from '@aiteam/contracts';
import {
  AGENT_DIRECTORY_QUERY,
  type AgentDirectoryQuery,
} from '../../../agents/application/ports/agent-directory.query';
import {
  DEPARTMENT_REPOSITORY,
  type DepartmentRepository,
} from '../../domain/repositories/department.repository';
import { toDepartmentDto } from './department-lookup';

/** Avatars shown on a department card. */
const MEMBER_PREVIEW_LIMIT = 5;

@Injectable()
export class SummarizeDepartmentsUseCase {
  constructor(
    @Inject(DEPARTMENT_REPOSITORY) private readonly departmentRepository: DepartmentRepository,
    @Inject(AGENT_DIRECTORY_QUERY) private readonly agentDirectory: AgentDirectoryQuery,
  ) {}

  summarizeDepartments(): DepartmentSummary[] {
    const agentsByDepartment = new Map<string, AgentSummary[]>();
    for (const agent of this.agentDirectory.listAgentSummaries({})) {
      const members = agentsByDepartment.get(agent.department.id) ?? [];
      members.push(agent);
      agentsByDepartment.set(agent.department.id, members);
    }

    return this.departmentRepository.listDepartments().map((department) => {
      const members = agentsByDepartment.get(department.id) ?? [];
      const head = members.find((member) => member.reportsToPositionId === null);
      const headFirst =
        head === undefined ? members : [head, ...members.filter((member) => member !== head)];
      return {
        ...toDepartmentDto(department, members.length),
        headAgentName: head?.name ?? null,
        memberPreview: headFirst.slice(0, MEMBER_PREVIEW_LIMIT).map((member) => ({
          agentId: member.id,
          name: member.name,
          provider: member.provider,
          enabled: member.enabled,
        })),
      };
    });
  }
}
