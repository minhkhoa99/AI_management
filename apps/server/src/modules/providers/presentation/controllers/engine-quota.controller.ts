import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { EngineQuotaReport } from '@aiteam/contracts';
import { EngineQuotaMonitor } from '../../application/use-cases/engine-quota-monitor';

/** Own controller (registered before LocalEnginesController) so `quota` never meets `:engine`. */
@Controller('api/local-engines/quota')
export class EngineQuotaController {
  constructor(private readonly engineQuotaMonitor: EngineQuotaMonitor) {}

  @Get()
  listEngineQuotas(): EngineQuotaReport[] {
    return this.engineQuotaMonitor.listEngineQuotas();
  }

  @Post('refresh')
  @HttpCode(200)
  refreshAllEngineQuotas(): Promise<EngineQuotaReport[]> {
    return this.engineQuotaMonitor.refreshAllEngineQuotas();
  }
}
