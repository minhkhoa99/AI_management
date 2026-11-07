import {
  activityListSchema,
  hourlyThroughputSchema,
  overviewMetricsSchema,
  providerUsageSchema,
  usageTodaySchema,
} from '@aiteam/contracts';
import { fetchApiJson } from '../../shared/api/api-client';

export const loadOverviewMetrics = () =>
  fetchApiJson('/api/overview/metrics', overviewMetricsSchema);

export const loadHourlyThroughput = () =>
  fetchApiJson('/api/overview/throughput', hourlyThroughputSchema);

export const loadUsageByProvider = () =>
  fetchApiJson('/api/overview/usage-by-provider', providerUsageSchema);

export const loadUsageToday = () => fetchApiJson('/api/overview/usage-today', usageTodaySchema);

export const loadRecentActivity = (limit = 6) =>
  fetchApiJson(`/api/activity?limit=${limit}`, activityListSchema);

/** "12.400" style numbers; tokens get k / M above ten thousand. */
export function formatCount(value: number): string {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString('vi', { maximumFractionDigits: 1 })}M`;
  if (value >= 10_000)
    return `${(value / 1_000).toLocaleString('vi', { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString('vi');
}
