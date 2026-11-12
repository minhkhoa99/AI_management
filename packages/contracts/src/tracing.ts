import { z } from 'zod';
import { agentProviderSchema } from './enumerations';
import { entityIdSchema } from './organization';
import { taskEventSchema } from './tasks';

// Live updates (server-sent events) and overview figures (phase 4).

export const LIVE_UPDATE_TYPES = [
  /** A task was created, changed status/step/assignee, or was deleted. */
  'task.changed',
  /** A new line in a task log (agent message, command, file change, checkpoint…). */
  'task.event',
  /** An approval request was created or decided. */
  'approval.changed',
  /** The usage limits of a local engine were just re-read. */
  'engine_quota.changed',
] as const;
export type LiveUpdateType = (typeof LIVE_UPDATE_TYPES)[number];

export const liveUpdateSchema = z.object({
  /** Increases by one per update; the SSE id, so a reconnecting client gets what it missed. */
  sequence: z.number().int().nonnegative(),
  type: z.enum(LIVE_UPDATE_TYPES),
  taskId: entityIdSchema.nullable(),
  departmentId: entityIdSchema.nullable(),
  agentId: entityIdSchema.nullable(),
  at: z.string(),
  /** Only for task.event. */
  event: taskEventSchema.nullable(),
});
export type LiveUpdate = z.infer<typeof liveUpdateSchema>;

/** Updates are grouped (200 ms) into one SSE message. */
export const liveUpdateBatchSchema = z.object({ items: z.array(liveUpdateSchema) });
export type LiveUpdateBatch = z.infer<typeof liveUpdateBatchSchema>;

// ---- Overview -------------------------------------------------------------------------------

export const OVERVIEW_DAY_COUNT = 7;

export const overviewMetricsSchema = z.object({
  tasksDoneToday: z.number().int().nonnegative(),
  tasksDoneYesterday: z.number().int().nonnegative(),
  /** Oldest first, today last. */
  tasksDoneByDay: z.array(z.number().int().nonnegative()),
  agentsWorking: z.number().int().nonnegative(),
  agentsEnabled: z.number().int().nonnegative(),
  agentsTotal: z.number().int().nonnegative(),
  /** Share of QC gates passed today, 0–100; null when QC did not run today. */
  qcPassRateToday: z.number().nullable(),
  qcPassRateByDay: z.array(z.number().nullable()),
  tokensToday: z.number().int().nonnegative(),
  tokensYesterday: z.number().int().nonnegative(),
  tokensByDay: z.array(z.number().int().nonnegative()),
  /** Money is only known for Custom API connections (signed-in CLIs have no per-call price). */
  apiCostTodayUsd: z.number().nonnegative(),
});
export type OverviewMetrics = z.infer<typeof overviewMetricsSchema>;

export const hourlyThroughputSchema = z.array(
  z.object({
    hour: z.number().int().min(0).max(23),
    done: z.number().int().nonnegative(),
    /** Steps retried or sent back, and tasks failed. */
    reworked: z.number().int().nonnegative(),
  }),
);
export type HourlyThroughput = z.infer<typeof hourlyThroughputSchema>;

export const providerUsageSchema = z.array(
  z.object({
    provider: agentProviderSchema,
    tokens: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().nullable(),
  }),
);
export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const usageTodaySchema = z.object({
  tokens: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
});
export type UsageToday = z.infer<typeof usageTodaySchema>;

export const activityItemSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  agentName: z.string().nullable(),
  task: z.object({ id: entityIdSchema, code: z.string(), title: z.string() }),
  text: z.string(),
  at: z.string(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
export const activityListSchema = z.array(activityItemSchema);
