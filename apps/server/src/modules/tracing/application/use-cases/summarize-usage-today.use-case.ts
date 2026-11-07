import { Injectable } from '@nestjs/common';
import type { UsageToday } from '@aiteam/contracts';
import { AggregateUsageByProviderUseCase } from './aggregate-usage-by-provider.use-case';

/** Sidebar meter "Hạn mức hôm nay": tokens and turns (no budget limit: postponed in phase 5). */
@Injectable()
export class SummarizeUsageTodayUseCase {
  constructor(private readonly aggregateUsageByProviderUseCase: AggregateUsageByProviderUseCase) {}

  summarizeUsageToday(): UsageToday {
    const usage = this.aggregateUsageByProviderUseCase.aggregateUsageByProvider();
    return {
      tokens: usage.reduce((total, row) => total + row.tokens, 0),
      turns: usage.reduce((total, row) => total + row.turns, 0),
    };
  }
}
