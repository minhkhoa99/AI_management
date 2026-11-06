import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentsModule } from './modules/agents/agents.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { OrchestrationModule } from './modules/orchestration/orchestration.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { TracingModule } from './modules/tracing/tracing.module';
import { AppExceptionFilter } from './shared/errors/app-exception.filter';
import { TraceContextMiddleware } from './shared/observability/trace-context.middleware';
import { AllowedHostMiddleware } from './shared/security/allowed-host.middleware';
import { RequestOriginMiddleware } from './shared/security/request-origin.middleware';
import { SessionCookieMiddleware } from './shared/security/session-cookie.middleware';
import { SessionExchangeMiddleware } from './shared/security/session-exchange.middleware';
import {
  type SharedInfrastructureDependencies,
  SharedInfrastructureModule,
} from './shared/shared-infrastructure.module';
import { SystemModule } from './system/system.module';

/** Matches every path, including "/" (path-to-regexp v8 optional wildcard). */
const ALL_PATHS = '{*path}';

@Module({})
export class AppModule implements NestModule {
  static register(dependencies: SharedInfrastructureDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SharedInfrastructureModule.register(dependencies),
        SystemModule,
        DepartmentsModule,
        AgentsModule,
        OrchestrationModule,
        ProvidersModule,
        TracingModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Order matters: trace id first so every rejection below is logged with it; Host before
    // anything that reads credentials; the session exchange before the cookie check.
    consumer
      .apply(
        TraceContextMiddleware,
        AllowedHostMiddleware,
        SessionExchangeMiddleware,
        RequestOriginMiddleware,
        SessionCookieMiddleware,
      )
      .forRoutes(ALL_PATHS);
  }
}
