import { Module } from '@nestjs/common';
import { GetServerHealthUseCase } from './application/get-server-health.use-case';
import { SYSTEM_CLOCK, wallClock } from './application/system-clock.port';
import { HealthController } from './presentation/health.controller';

/** Process-level endpoints that belong to no business module (health). */
@Module({
  controllers: [HealthController],
  providers: [GetServerHealthUseCase, { provide: SYSTEM_CLOCK, useValue: wallClock }],
})
export class SystemModule {}
