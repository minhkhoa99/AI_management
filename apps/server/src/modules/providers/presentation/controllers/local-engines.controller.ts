import { Body, Controller, Get, HttpCode, Param, Patch, Post, Sse } from '@nestjs/common';
import {
  entityIdSchema,
  type LocalEngine,
  type LocalEngineModelList,
  type LocalEngineSettings,
  type LocalEngineStatus,
  localEngineSchema,
  type UpdateLocalEngineSettingsRequest,
  updateLocalEngineSettingsRequestSchema,
} from '@aiteam/contracts';
import { map, type Observable } from 'rxjs';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { CancelEngineTestRunUseCase } from '../../application/use-cases/cancel-engine-test-run.use-case';
import { ListLocalEngineModelsUseCase } from '../../application/use-cases/list-local-engine-models.use-case';
import { ListLocalEnginesUseCase } from '../../application/use-cases/list-local-engines.use-case';
import { StartLocalEngineTestRunUseCase } from '../../application/use-cases/start-local-engine-test-run.use-case';
import { UpdateLocalEngineSettingsUseCase } from '../../application/use-cases/update-local-engine-settings.use-case';
import { WatchEngineTestRunUseCase } from '../../application/use-cases/watch-engine-test-run.use-case';

const enginePipe = new ZodRequestPipe(localEngineSchema, 'Engine');
const testRunIdPipe = new ZodRequestPipe(entityIdSchema, 'Mã lần chạy thử');

@Controller('api/local-engines')
export class LocalEnginesController {
  constructor(
    private readonly listLocalEnginesUseCase: ListLocalEnginesUseCase,
    private readonly listLocalEngineModelsUseCase: ListLocalEngineModelsUseCase,
    private readonly updateLocalEngineSettingsUseCase: UpdateLocalEngineSettingsUseCase,
    private readonly startLocalEngineTestRunUseCase: StartLocalEngineTestRunUseCase,
  ) {}

  @Get()
  listLocalEngines(): Promise<LocalEngineStatus[]> {
    return this.listLocalEnginesUseCase.listLocalEngines();
  }

  /** Quick picks of the agent model picker; Codex's come from its own catalog. */
  @Get(':engine/models')
  listLocalEngineModels(
    @Param('engine', enginePipe) engine: LocalEngine,
  ): Promise<LocalEngineModelList> {
    return this.listLocalEngineModelsUseCase.listLocalEngineModels(engine);
  }

  @Patch(':engine/settings')
  updateLocalEngineSettings(
    @Param('engine', enginePipe) engine: LocalEngine,
    @Body(new ZodRequestPipe(updateLocalEngineSettingsRequestSchema))
    request: UpdateLocalEngineSettingsRequest,
  ): LocalEngineSettings {
    return this.updateLocalEngineSettingsUseCase.updateLocalEngineSettings(engine, request);
  }

  @Post(':engine/test-runs')
  startLocalEngineTestRun(@Param('engine', enginePipe) engine: LocalEngine): { testRunId: string } {
    return this.startLocalEngineTestRunUseCase.startLocalEngineTestRun(engine);
  }
}

/** Test runs of local engines and Custom API connections share one stream endpoint. */
@Controller('api/engine-test-runs')
export class EngineTestRunsController {
  constructor(
    private readonly watchEngineTestRunUseCase: WatchEngineTestRunUseCase,
    private readonly cancelEngineTestRunUseCase: CancelEngineTestRunUseCase,
  ) {}

  // `data` is the field name Nest's SSE MessageEvent requires.
  /* eslint-disable id-denylist */
  @Sse(':testRunId/events')
  watchEngineTestRun(
    @Param('testRunId', testRunIdPipe) testRunId: string,
  ): Observable<{ id: string; data: object }> {
    return this.watchEngineTestRunUseCase
      .watchEngineTestRun(testRunId)
      .pipe(map((message) => ({ id: String(message.sequence), data: message })));
  }
  /* eslint-enable id-denylist */

  @Post(':testRunId/cancellation')
  @HttpCode(204)
  cancelEngineTestRun(@Param('testRunId', testRunIdPipe) testRunId: string): void {
    this.cancelEngineTestRunUseCase.cancelEngineTestRun(testRunId);
  }
}
