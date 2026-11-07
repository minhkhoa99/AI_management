import { Controller, Get, Query } from '@nestjs/common';
import type {
  ActivityItem,
  HourlyThroughput,
  OverviewMetrics,
  ProviderUsage,
  UsageToday,
} from '@aiteam/contracts';
import { z } from 'zod';
import { ZodRequestPipe } from '../../../../shared/validation/zod-request.pipe';
import { AggregateHourlyThroughputUseCase } from '../../application/use-cases/aggregate-hourly-throughput.use-case';
import { AggregateUsageByProviderUseCase } from '../../application/use-cases/aggregate-usage-by-provider.use-case';
import { CalculateOverviewMetricsUseCase } from '../../application/use-cases/calculate-overview-metrics.use-case';
import { ListRecentActivityUseCase } from '../../application/use-cases/list-recent-activity.use-case';
import { SummarizeUsageTodayUseCase } from '../../application/use-cases/summarize-usage-today.use-case';

@Controller('api')
export class OverviewController {
  constructor(
    private readonly calculateOverviewMetricsUseCase: CalculateOverviewMetricsUseCase,
    private readonly aggregateHourlyThroughputUseCase: AggregateHourlyThroughputUseCase,
    private readonly aggregateUsageByProviderUseCase: AggregateUsageByProviderUseCase,
    private readonly summarizeUsageTodayUseCase: SummarizeUsageTodayUseCase,
    private readonly listRecentActivityUseCase: ListRecentActivityUseCase,
  ) {}

  @Get('overview/metrics')
  calculateOverviewMetrics(): OverviewMetrics {
    return this.calculateOverviewMetricsUseCase.calculateOverviewMetrics();
  }

  @Get('overview/throughput')
  aggregateHourlyThroughput(): HourlyThroughput {
    return this.aggregateHourlyThroughputUseCase.aggregateHourlyThroughput();
  }

  @Get('overview/usage-by-provider')
  aggregateUsageByProvider(): ProviderUsage {
    return this.aggregateUsageByProviderUseCase.aggregateUsageByProvider();
  }

  @Get('overview/usage-today')
  summarizeUsageToday(): UsageToday {
    return this.summarizeUsageTodayUseCase.summarizeUsageToday();
  }

  @Get('activity')
  listRecentActivity(
    @Query(
      'limit',
      new ZodRequestPipe(z.coerce.number().int().min(1).max(50).default(6), 'Số dòng'),
    )
    limit: number,
  ): ActivityItem[] {
    return this.listRecentActivityUseCase.listRecentActivity(limit);
  }
}
