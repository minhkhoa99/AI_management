import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  type AgentDetail,
  type AgentListQuery,
  type AgentSummary,
  agentListQuerySchema,
  type BulkSetAgentsEnabledRequest,
  bulkSetAgentsEnabledRequestSchema,
  entityIdSchema,
  type SetEnabledRequest,
  setEnabledRequestSchema,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { GetAgentDetailUseCase } from '../../application/use-cases/get-agent-detail.use-case';
import { ListAgentsUseCase } from '../../application/use-cases/list-agents.use-case';
import { ToggleAgentUseCase } from '../../application/use-cases/toggle-agent.use-case';
import { ToggleAgentsInBulkUseCase } from '../../application/use-cases/toggle-agents-in-bulk.use-case';

const agentIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã agent');

@Controller('api/agents')
export class AgentsController {
  constructor(
    private readonly listAgentsUseCase: ListAgentsUseCase,
    private readonly getAgentDetailUseCase: GetAgentDetailUseCase,
    private readonly toggleAgentUseCase: ToggleAgentUseCase,
    private readonly toggleAgentsInBulkUseCase: ToggleAgentsInBulkUseCase,
  ) {}

  @Get()
  listAgents(
    @Query(new ZodRequestPipe(agentListQuerySchema, 'Tham số lọc')) query: AgentListQuery,
  ): AgentSummary[] {
    return this.listAgentsUseCase.listAgents({
      departmentId: query.departmentId,
      searchText: query.q,
    });
  }

  @Patch('enabled')
  toggleAgentsInBulk(
    @Body(new ZodRequestPipe(bulkSetAgentsEnabledRequestSchema))
    request: BulkSetAgentsEnabledRequest,
  ): { updatedCount: number } {
    return this.toggleAgentsInBulkUseCase.toggleAgentsInBulk(request);
  }

  @Get(':agentId')
  getAgentDetail(@Param('agentId', agentIdPipe) agentId: string): AgentDetail {
    return this.getAgentDetailUseCase.getAgentDetail(agentId);
  }

  @Patch(':agentId/enabled')
  toggleAgent(
    @Param('agentId', agentIdPipe) agentId: string,
    @Body(new ZodRequestPipe(setEnabledRequestSchema)) request: SetEnabledRequest,
  ): AgentDetail {
    return this.toggleAgentUseCase.toggleAgent(agentId, request.enabled);
  }
}
