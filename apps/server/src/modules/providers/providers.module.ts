import { Module } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { AgentsModule } from '../agents/agents.module';
import { AGENT_ENGINE_RESOLVER } from '../orchestration/application/ports/agent-engine.port';
import { AGENT_RUN_PREPARER } from '../orchestration/application/ports/task-execution.ports';
import { PrepareAgentRunUseCase } from './application/use-cases/prepare-agent-run.use-case';
import { EngineTestRunRegistry } from './application/engine-test-run-registry';
import { CODEX_MODEL_CATALOG } from './application/ports/codex-model-catalog.port';
import { LOCAL_ENGINE_PROBE } from './application/ports/local-engine-probe.port';
import { MODEL_CATALOG } from './application/ports/model-catalog.port';
import { SAMPLE_WORKSPACE_FACTORY } from './application/ports/sample-workspace.port';
import { SECRET_VAULT } from './application/ports/secret-vault.port';
import { CancelEngineTestRunUseCase } from './application/use-cases/cancel-engine-test-run.use-case';
import { CheckProviderConnectionUseCase } from './application/use-cases/check-provider-connection.use-case';
import { CreateProviderConnectionUseCase } from './application/use-cases/create-provider-connection.use-case';
import { DeleteProviderConnectionUseCase } from './application/use-cases/delete-provider-connection.use-case';
import { DiscoverModelsUseCase } from './application/use-cases/discover-models.use-case';
import { ListLocalEngineModelsUseCase } from './application/use-cases/list-local-engine-models.use-case';
import { ListLocalEnginesUseCase } from './application/use-cases/list-local-engines.use-case';
import { ListProviderConnectionsUseCase } from './application/use-cases/list-provider-connections.use-case';
import { StartConnectionTestRunUseCase } from './application/use-cases/start-connection-test-run.use-case';
import { StartLocalEngineTestRunUseCase } from './application/use-cases/start-local-engine-test-run.use-case';
import { UpdateLocalEngineSettingsUseCase } from './application/use-cases/update-local-engine-settings.use-case';
import { UpdateProviderConnectionUseCase } from './application/use-cases/update-provider-connection.use-case';
import { WatchEngineTestRunUseCase } from './application/use-cases/watch-engine-test-run.use-case';
import { LOCAL_ENGINE_SETTINGS_REPOSITORY } from './domain/repositories/local-engine-settings.repository';
import { PROVIDER_CONNECTION_REPOSITORY } from './domain/repositories/provider-connection.repository';
import { AesGcmSecretVault } from './infrastructure/adapters/aes-gcm-secret-vault';
import { CliCodexModelCatalog } from './infrastructure/adapters/cli-codex-model-catalog';
import { CliLocalEngineProbe } from './infrastructure/adapters/cli-local-engine.probe';
import { EngineRegistry } from './infrastructure/adapters/engines/agent-engine-resolver';
import { AnthropicApiEngine } from './infrastructure/adapters/engines/anthropic-api.engine';
import { ClaudeCodeCliEngine } from './infrastructure/adapters/engines/claude-code-cli.engine';
import { CodexCliEngine } from './infrastructure/adapters/engines/codex-cli.engine';
import { CustomApiEngine } from './infrastructure/adapters/engines/custom-api.engine';
import { OpenAiCompatibleEngine } from './infrastructure/adapters/engines/openai-compatible.engine';
import { HttpModelCatalog } from './infrastructure/adapters/http-model-catalog';
import { TemporarySampleWorkspaceFactory } from './infrastructure/adapters/temporary-sample-workspace.factory';
import { SqliteLocalEngineSettingsRepository } from './infrastructure/persistence/sqlite-local-engine-settings.repository';
import { SqliteProviderConnectionRepository } from './infrastructure/persistence/sqlite-provider-connection.repository';
import {
  EngineTestRunsController,
  LocalEnginesController,
} from './presentation/controllers/local-engines.controller';
import { ProviderConnectionsController } from './presentation/controllers/provider-connections.controller';

/** Agent engines (Claude Code, Codex, Custom API), their settings and provider connections. */
@Module({
  imports: [AgentsModule],
  controllers: [LocalEnginesController, EngineTestRunsController, ProviderConnectionsController],
  providers: [
    { provide: PROVIDER_CONNECTION_REPOSITORY, useClass: SqliteProviderConnectionRepository },
    { provide: LOCAL_ENGINE_SETTINGS_REPOSITORY, useClass: SqliteLocalEngineSettingsRepository },
    {
      provide: SECRET_VAULT,
      inject: [APP_RUNTIME_CONFIG],
      useFactory: (runtimeConfig: AppRuntimeConfig) =>
        new AesGcmSecretVault(runtimeConfig.secretKeyFilePath),
    },
    { provide: MODEL_CATALOG, useClass: HttpModelCatalog },
    { provide: LOCAL_ENGINE_PROBE, useClass: CliLocalEngineProbe },
    { provide: CODEX_MODEL_CATALOG, useClass: CliCodexModelCatalog },
    { provide: SAMPLE_WORKSPACE_FACTORY, useClass: TemporarySampleWorkspaceFactory },
    ClaudeCodeCliEngine,
    CodexCliEngine,
    AnthropicApiEngine,
    OpenAiCompatibleEngine,
    CustomApiEngine,
    { provide: AGENT_ENGINE_RESOLVER, useClass: EngineRegistry },
    EngineTestRunRegistry,
    ListProviderConnectionsUseCase,
    CreateProviderConnectionUseCase,
    UpdateProviderConnectionUseCase,
    DeleteProviderConnectionUseCase,
    DiscoverModelsUseCase,
    CheckProviderConnectionUseCase,
    ListLocalEnginesUseCase,
    ListLocalEngineModelsUseCase,
    UpdateLocalEngineSettingsUseCase,
    StartLocalEngineTestRunUseCase,
    StartConnectionTestRunUseCase,
    CancelEngineTestRunUseCase,
    WatchEngineTestRunUseCase,
    { provide: AGENT_RUN_PREPARER, useClass: PrepareAgentRunUseCase },
  ],
  // Orchestration starts task sessions through these.
  exports: [AGENT_ENGINE_RESOLVER, AGENT_RUN_PREPARER],
})
export class ProvidersModule {}
