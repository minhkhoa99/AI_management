import { Module } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { APP_LOGGER, type AppLogger } from '../../shared/logging/app-logger';
import {
  LOCAL_ENGINE_ADAPTERS_OVERRIDE,
  type LocalEngineAdaptersOverride,
} from '../../shared/runtime/local-engine-adapters-override';
import { AgentsModule } from '../agents/agents.module';
import { AGENT_ENGINE_RESOLVER } from '../orchestration/application/ports/agent-engine.port';
import { AGENT_RUN_PREPARER } from '../orchestration/application/ports/task-execution.ports';
import { ENGINE_QUOTA_GATEWAY } from '../orchestration/application/ports/engine-quota.port';
import {
  ENGINE_QUOTA_READERS,
  type EngineQuotaReader,
} from './application/ports/engine-quota-reader.port';
import { EngineQuotaMonitor } from './application/use-cases/engine-quota-monitor';
import { CliAntigravityQuotaReader } from './infrastructure/adapters/quota/cli-antigravity-quota.reader';
import { CliClaudeQuotaReader } from './infrastructure/adapters/quota/cli-claude-quota.reader';
import { CliCodexQuotaReader } from './infrastructure/adapters/quota/cli-codex-quota.reader';
import { EngineQuotaController } from './presentation/controllers/engine-quota.controller';
import { PrepareAgentRunUseCase } from './application/use-cases/prepare-agent-run.use-case';
import { EngineTestRunRegistry } from './application/engine-test-run-registry';
import { ANTIGRAVITY_MODEL_CATALOG } from './application/ports/antigravity-model-catalog.port';
import { CLAUDE_MODEL_CATALOG } from './application/ports/claude-model-catalog.port';
import { CLI_UPDATE_CHECKER } from './application/ports/cli-update-checker.port';
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
import { CliAntigravityModelCatalog } from './infrastructure/adapters/cli-antigravity-model-catalog';
import { CliClaudeModelCatalog } from './infrastructure/adapters/cli-claude-model-catalog';
import { CliCodexModelCatalog } from './infrastructure/adapters/cli-codex-model-catalog';
import { NpmCliUpdateChecker } from './infrastructure/adapters/npm-cli-update-checker';
import { CLAUDE_CODE_MODEL_CHOICES } from './domain/claude-code-models';
import { CliLocalEngineProbe } from './infrastructure/adapters/cli-local-engine.probe';
import { EngineRegistry } from './infrastructure/adapters/engines/agent-engine-resolver';
import { AnthropicApiEngine } from './infrastructure/adapters/engines/anthropic-api.engine';
import { AntigravityCliEngine } from './infrastructure/adapters/engines/antigravity-cli.engine';
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

/** Agent engines (Claude Code, Codex, Antigravity, Custom API), their settings and provider connections. */
@Module({
  imports: [AgentsModule],
  controllers: [
    EngineQuotaController,
    LocalEnginesController,
    EngineTestRunsController,
    ProviderConnectionsController,
  ],
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
    {
      provide: LOCAL_ENGINE_PROBE,
      inject: [LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      useFactory: (override: LocalEngineAdaptersOverride) =>
        override?.probe ?? new CliLocalEngineProbe(),
    },
    {
      provide: CLAUDE_MODEL_CATALOG,
      inject: [APP_RUNTIME_CONFIG, LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      useFactory: (runtimeConfig: AppRuntimeConfig, override: LocalEngineAdaptersOverride) =>
        override === null
          ? new CliClaudeModelCatalog(runtimeConfig.dataDirectory)
          : (override.claudeModelCatalog ?? {
              listClaudeModels: () => Promise.resolve([...CLAUDE_CODE_MODEL_CHOICES]),
            }),
    },
    {
      provide: CODEX_MODEL_CATALOG,
      inject: [APP_RUNTIME_CONFIG, LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      useFactory: (runtimeConfig: AppRuntimeConfig, override: LocalEngineAdaptersOverride) =>
        override?.codexModelCatalog ?? new CliCodexModelCatalog(runtimeConfig.dataDirectory),
    },
    {
      provide: CLI_UPDATE_CHECKER,
      inject: [APP_RUNTIME_CONFIG, APP_LOGGER, LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      // Tests that override adapters never reach registry.npmjs.org.
      useFactory: (
        runtimeConfig: AppRuntimeConfig,
        logger: AppLogger,
        override: LocalEngineAdaptersOverride,
      ) =>
        override === null
          ? new NpmCliUpdateChecker(runtimeConfig.dataDirectory, logger)
          : (override.cliUpdateChecker ?? { findCliUpdate: () => Promise.resolve(null) }),
    },
    {
      provide: ANTIGRAVITY_MODEL_CATALOG,
      inject: [LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      useFactory: (override: LocalEngineAdaptersOverride) =>
        override?.antigravityModelCatalog ?? new CliAntigravityModelCatalog(),
    },
    {
      provide: ENGINE_QUOTA_READERS,
      inject: [APP_RUNTIME_CONFIG, LOCAL_ENGINE_ADAPTERS_OVERRIDE],
      useFactory: (
        runtimeConfig: AppRuntimeConfig,
        override: LocalEngineAdaptersOverride,
      ): EngineQuotaReader[] =>
        // Tests that override adapters without quota readers never spawn the real CLIs.
        override === null
          ? [
              new CliClaudeQuotaReader(runtimeConfig.dataDirectory),
              new CliCodexQuotaReader(runtimeConfig.dataDirectory),
              new CliAntigravityQuotaReader(runtimeConfig.dataDirectory),
            ]
          : (override.quotaReaders ?? []),
    },
    EngineQuotaMonitor,
    { provide: ENGINE_QUOTA_GATEWAY, useExisting: EngineQuotaMonitor },
    { provide: SAMPLE_WORKSPACE_FACTORY, useClass: TemporarySampleWorkspaceFactory },
    ClaudeCodeCliEngine,
    CodexCliEngine,
    AntigravityCliEngine,
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
  exports: [AGENT_ENGINE_RESOLVER, AGENT_RUN_PREPARER, ENGINE_QUOTA_GATEWAY],
})
export class ProvidersModule {}
