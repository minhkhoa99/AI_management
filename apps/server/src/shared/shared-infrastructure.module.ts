import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../app-runtime-config';
import { SQLITE_DATABASE } from './database/sqlite-connection';
import { APP_LOGGER, type AppLogger } from './logging/app-logger';

export interface SharedInfrastructureDependencies {
  runtimeConfig: AppRuntimeConfig;
  database: DatabaseSync;
  logger: AppLogger;
}

/**
 * Exposes process-wide singletons (config, SQLite connection, logger) to every module.
 * They are created outside Nest by the launcher so their lifetime is explicit.
 */
@Global()
@Module({})
export class SharedInfrastructureModule {
  static register(dependencies: SharedInfrastructureDependencies): DynamicModule {
    const providers = [
      { provide: APP_RUNTIME_CONFIG, useValue: dependencies.runtimeConfig },
      { provide: SQLITE_DATABASE, useValue: dependencies.database },
      { provide: APP_LOGGER, useValue: dependencies.logger },
    ];
    return {
      module: SharedInfrastructureModule,
      providers,
      exports: providers.map((provider) => provider.provide),
    };
  }
}
