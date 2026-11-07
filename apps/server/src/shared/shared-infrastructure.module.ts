import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../app-runtime-config';
import { SQLITE_DATABASE } from './database/sqlite-connection';
import { SqliteTransactionRunner, TRANSACTION_RUNNER } from './database/transaction-runner';
import { DOMAIN_EVENT_PUBLISHER } from './events/domain-event';
import { InProcessDomainEventBus } from './events/in-process-domain-event-bus';
import { ID_GENERATOR, randomUuidGenerator } from './identifiers/id-generator';
import { AgentSessionSupervisor } from './runtime/agent-session-supervisor';
import { CLI_PROCESS_TRACKER, SqliteCliProcessTracker } from './runtime/cli-process-tracker';
import {
  AGENT_ENGINE_OVERRIDE,
  type AgentEngineOverride,
  TASK_SCHEDULER_ENABLED,
} from './runtime/agent-engine-override';
import { DIRECTORY_PICKER, type DirectoryPicker } from './runtime/directory-picker';
import { NativeDirectoryPicker } from './runtime/native-directory-picker';
import { OsProcessInspector } from './runtime/os-process-inspector';
import { PROCESS_INSPECTOR, type ProcessInspector } from './runtime/process-identity';
import {
  osProcessTerminator,
  PROCESS_TERMINATOR,
  type ProcessTerminator,
} from './runtime/process-termination';
import { APP_LOGGER, type AppLogger } from './logging/app-logger';

export interface SharedInfrastructureDependencies {
  runtimeConfig: AppRuntimeConfig;
  database: DatabaseSync;
  logger: AppLogger;
  /** Overridable in tests; defaults read and kill real OS processes. */
  processInspector?: ProcessInspector;
  processTerminator?: ProcessTerminator;
  /** Overridable in tests; defaults to the OS folder dialog. */
  directoryPicker?: DirectoryPicker;
  /** Tests only: replaces every agent engine. */
  agentEngineOverride?: AgentEngineOverride;
  /** false: queued tasks never start (tests that do not script an engine). Default true. */
  taskSchedulerEnabled?: boolean;
  /** Shared with the launcher so a fatal error can cancel running sessions. */
  sessionSupervisor?: AgentSessionSupervisor;
}

/**
 * Exposes process-wide singletons (config, SQLite connection, logger) to every module.
 * They are created outside Nest by the launcher so their lifetime is explicit.
 */
@Global()
@Module({})
export class SharedInfrastructureModule {
  static register(dependencies: SharedInfrastructureDependencies): DynamicModule {
    const domainEventBus = new InProcessDomainEventBus(dependencies.logger);
    const processInspector = dependencies.processInspector ?? new OsProcessInspector();
    const sessionSupervisor =
      dependencies.sessionSupervisor ??
      new AgentSessionSupervisor(randomUuidGenerator, dependencies.logger);
    const providers = [
      { provide: APP_RUNTIME_CONFIG, useValue: dependencies.runtimeConfig },
      { provide: SQLITE_DATABASE, useValue: dependencies.database },
      { provide: APP_LOGGER, useValue: dependencies.logger },
      {
        provide: TRANSACTION_RUNNER,
        useValue: new SqliteTransactionRunner(dependencies.database),
      },
      { provide: ID_GENERATOR, useValue: randomUuidGenerator },
      { provide: InProcessDomainEventBus, useValue: domainEventBus },
      { provide: DOMAIN_EVENT_PUBLISHER, useValue: domainEventBus },
      { provide: PROCESS_INSPECTOR, useValue: processInspector },
      {
        provide: PROCESS_TERMINATOR,
        useValue: dependencies.processTerminator ?? osProcessTerminator,
      },
      {
        provide: CLI_PROCESS_TRACKER,
        useValue: new SqliteCliProcessTracker(
          dependencies.database,
          processInspector,
          randomUuidGenerator,
          dependencies.logger,
        ),
      },
      { provide: AgentSessionSupervisor, useValue: sessionSupervisor },
      {
        provide: DIRECTORY_PICKER,
        useValue: dependencies.directoryPicker ?? new NativeDirectoryPicker(dependencies.logger),
      },
      { provide: AGENT_ENGINE_OVERRIDE, useValue: dependencies.agentEngineOverride ?? null },
      { provide: TASK_SCHEDULER_ENABLED, useValue: dependencies.taskSchedulerEnabled ?? true },
    ];
    return {
      module: SharedInfrastructureModule,
      providers,
      exports: providers.map((provider) => provider.provide),
    };
  }
}
