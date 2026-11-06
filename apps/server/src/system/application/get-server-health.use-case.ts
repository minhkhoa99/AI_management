import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@aiteam/contracts';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../app-runtime-config';
import { SYSTEM_CLOCK, type SystemClock } from './system-clock.port';

@Injectable()
export class GetServerHealthUseCase {
  constructor(
    @Inject(APP_RUNTIME_CONFIG) private readonly runtimeConfig: AppRuntimeConfig,
    @Inject(SYSTEM_CLOCK) private readonly clock: SystemClock,
  ) {}

  getServerHealth(): HealthResponse {
    const uptimeMs = Math.max(0, this.clock.nowEpochMs() - this.runtimeConfig.startedAtEpochMs);
    return {
      status: 'ok',
      version: this.runtimeConfig.version,
      uptimeSeconds: Math.floor(uptimeMs / 1000),
    };
  }
}
