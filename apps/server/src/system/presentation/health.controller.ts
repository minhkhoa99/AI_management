import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@aiteam/contracts';
import { GetServerHealthUseCase } from '../application/get-server-health.use-case';

@Controller('api/health')
export class HealthController {
  constructor(private readonly getServerHealthUseCase: GetServerHealthUseCase) {}

  @Get()
  getHealth(): HealthResponse {
    return this.getServerHealthUseCase.getServerHealth();
  }
}
