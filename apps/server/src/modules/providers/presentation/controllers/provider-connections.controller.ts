import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  type ConnectionCheckResult,
  entityIdSchema,
  type ModelDiscoveryRequest,
  modelDiscoveryRequestSchema,
  type ProviderConnection,
  type SaveProviderConnectionRequest,
  saveProviderConnectionRequestSchema,
  startConnectionTestRunRequestSchema,
} from '@aiteam/contracts';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { CheckProviderConnectionUseCase } from '../../application/use-cases/check-provider-connection.use-case';
import { CreateProviderConnectionUseCase } from '../../application/use-cases/create-provider-connection.use-case';
import { DeleteProviderConnectionUseCase } from '../../application/use-cases/delete-provider-connection.use-case';
import { DiscoverModelsUseCase } from '../../application/use-cases/discover-models.use-case';
import { ListProviderConnectionsUseCase } from '../../application/use-cases/list-provider-connections.use-case';
import { StartConnectionTestRunUseCase } from '../../application/use-cases/start-connection-test-run.use-case';
import { UpdateProviderConnectionUseCase } from '../../application/use-cases/update-provider-connection.use-case';

const connectionIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã kết nối');

@Controller('api/provider-connections')
export class ProviderConnectionsController {
  constructor(
    private readonly listProviderConnectionsUseCase: ListProviderConnectionsUseCase,
    private readonly createProviderConnectionUseCase: CreateProviderConnectionUseCase,
    private readonly updateProviderConnectionUseCase: UpdateProviderConnectionUseCase,
    private readonly deleteProviderConnectionUseCase: DeleteProviderConnectionUseCase,
    private readonly discoverModelsUseCase: DiscoverModelsUseCase,
    private readonly checkProviderConnectionUseCase: CheckProviderConnectionUseCase,
    private readonly startConnectionTestRunUseCase: StartConnectionTestRunUseCase,
  ) {}

  @Get()
  listProviderConnections(): ProviderConnection[] {
    return this.listProviderConnectionsUseCase.listProviderConnections();
  }

  @Post()
  createProviderConnection(
    @Body(new ZodRequestPipe(saveProviderConnectionRequestSchema))
    request: SaveProviderConnectionRequest,
  ): ProviderConnection {
    return this.createProviderConnectionUseCase.createProviderConnection(request);
  }

  @Post('model-discovery')
  @HttpCode(200)
  discoverModels(
    @Body(new ZodRequestPipe(modelDiscoveryRequestSchema)) request: ModelDiscoveryRequest,
  ): Promise<{ models: string[] }> {
    return this.discoverModelsUseCase.discoverModels(request);
  }

  @Patch(':connectionId')
  updateProviderConnection(
    @Param('connectionId', connectionIdPipe) connectionId: string,
    @Body(new ZodRequestPipe(saveProviderConnectionRequestSchema))
    request: SaveProviderConnectionRequest,
  ): ProviderConnection {
    return this.updateProviderConnectionUseCase.updateProviderConnection(connectionId, request);
  }

  @Delete(':connectionId')
  @HttpCode(204)
  deleteProviderConnection(@Param('connectionId', connectionIdPipe) connectionId: string): void {
    this.deleteProviderConnectionUseCase.deleteProviderConnection(connectionId);
  }

  @Post(':connectionId/checks')
  @HttpCode(200)
  checkProviderConnection(
    @Param('connectionId', connectionIdPipe) connectionId: string,
  ): Promise<ConnectionCheckResult> {
    return this.checkProviderConnectionUseCase.checkProviderConnection(connectionId);
  }

  @Post(':connectionId/test-runs')
  startConnectionTestRun(
    @Param('connectionId', connectionIdPipe) connectionId: string,
    @Body(new ZodRequestPipe(startConnectionTestRunRequestSchema)) request: { model: string },
  ): { testRunId: string } {
    return this.startConnectionTestRunUseCase.startConnectionTestRun(connectionId, request.model);
  }
}
