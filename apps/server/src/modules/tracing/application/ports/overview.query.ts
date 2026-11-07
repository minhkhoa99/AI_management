import type { AgentProvider } from '@aiteam/contracts';

export const OVERVIEW_QUERY = Symbol('OVERVIEW_QUERY');

/** Local calendar day "YYYY-MM-DD" (the machine's time zone). */
export type LocalDay = string;

export interface DailyFigures {
  tasksDone: Map<LocalDay, number>;
  qcGates: Map<LocalDay, { passed: number; total: number }>;
  tokens: Map<LocalDay, number>;
}

export interface ActivityRecord {
  id: number;
  kind: string;
  agentName: string | null;
  taskId: string;
  taskSequenceNumber: number;
  taskTitle: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Read-only aggregates over the task log for the overview screen. */
export interface OverviewQuery {
  /** Figures per local day from `sinceIso` on. */
  readDailyFigures(sinceIso: string): DailyFigures;
  countAgents(): { total: number; enabled: number; working: number };
  /** Cost of Custom API turns since `sinceIso` (the only engine with a price per call). */
  sumApiCostUsd(sinceIso: string): number;
  /** Per local hour (0–23) since `sinceIso`. */
  readHourlyThroughput(sinceIso: string): Map<number, { done: number; reworked: number }>;
  readUsageByProvider(
    sinceIso: string,
  ): Array<{ provider: AgentProvider; tokens: number; turns: number; costUsd: number }>;
  listRecentActivity(limit: number): ActivityRecord[];
}
