import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { AgentProvider } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  ActivityRecord,
  DailyFigures,
  OverviewQuery,
} from '../../application/ports/overview.query';

/** Notable steps shown under "Hoạt động gần đây" (not every agent message). */
const ACTIVITY_KINDS = [
  'turn_started',
  'step_passed',
  'step_returned',
  'step_retried',
  'review_finished',
  'approval_requested',
  'approval_decided',
  'task_succeeded',
  'task_failed',
  'delegated',
];
const REWORK_KINDS = "('step_retried', 'step_returned', 'task_failed')";
const TOKENS_EXPRESSION =
  "COALESCE(json_extract(e.payload_json, '$.inputTokens'), 0) + COALESCE(json_extract(e.payload_json, '$.outputTokens'), 0)";

@Injectable()
export class SqliteOverviewQuery implements OverviewQuery {
  private readonly doneByDayStatement: StatementSync;
  private readonly qcByDayStatement: StatementSync;
  private readonly tokensByDayStatement: StatementSync;
  private readonly agentsStatement: StatementSync;
  private readonly apiCostStatement: StatementSync;
  private readonly hourlyStatement: StatementSync;
  private readonly usageByProviderStatement: StatementSync;
  private readonly activityStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.doneByDayStatement = database.prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS amount FROM task_events
       WHERE kind = 'task_succeeded' AND created_at >= ? GROUP BY day`,
    );
    this.qcByDayStatement = database.prepare(
      `SELECT date(created_at, 'localtime') AS day,
              SUM(CASE WHEN json_extract(payload_json, '$.passed') = 1 THEN 1 ELSE 0 END) AS passed,
              COUNT(*) AS total
       FROM task_events
       WHERE kind = 'gate_evaluated' AND json_extract(payload_json, '$.gate') = 'qc_pass'
         AND created_at >= ?
       GROUP BY day`,
    );
    this.tokensByDayStatement = database.prepare(
      `SELECT date(e.created_at, 'localtime') AS day, SUM(${TOKENS_EXPRESSION}) AS amount
       FROM task_events e WHERE e.kind = 'usage' AND e.created_at >= ? GROUP BY day`,
    );
    this.agentsStatement = database.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN a.enabled = 1 AND d.enabled = 1 THEN 1 ELSE 0 END) AS enabled,
              (SELECT COUNT(DISTINCT assignee_agent_id) FROM tasks WHERE status = 'running') AS working
       FROM agents a
       JOIN positions p ON p.agent_id = a.id
       JOIN departments d ON d.id = p.department_id`,
    );
    this.apiCostStatement = database.prepare(
      `SELECT COALESCE(SUM(json_extract(e.payload_json, '$.costUsd')), 0) AS cost
       FROM task_events e JOIN agents a ON a.id = e.agent_id
       WHERE e.kind = 'usage' AND a.provider = 'custom_api' AND e.created_at >= ?`,
    );
    this.hourlyStatement = database.prepare(
      `SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) AS hour,
              SUM(CASE WHEN kind = 'task_succeeded' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN kind IN ${REWORK_KINDS} THEN 1 ELSE 0 END) AS reworked
       FROM task_events
       WHERE created_at >= ? AND (kind = 'task_succeeded' OR kind IN ${REWORK_KINDS})
       GROUP BY hour`,
    );
    this.usageByProviderStatement = database.prepare(
      `SELECT a.provider, SUM(${TOKENS_EXPRESSION}) AS tokens, COUNT(*) AS turns,
              COALESCE(SUM(json_extract(e.payload_json, '$.costUsd')), 0) AS cost
       FROM task_events e JOIN agents a ON a.id = e.agent_id
       WHERE e.kind = 'usage' AND e.created_at >= ?
       GROUP BY a.provider`,
    );
    this.activityStatement = database.prepare(
      `SELECT e.id, e.kind, a.name AS agent_name, t.id AS task_id, t.sequence_number, t.title,
              e.payload_json, e.created_at
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN agents a ON a.id = e.agent_id
       WHERE e.kind IN (${ACTIVITY_KINDS.map((kind) => `'${kind}'`).join(', ')})
       ORDER BY e.id DESC LIMIT ?`,
    );
  }

  readDailyFigures(sinceIso: string): DailyFigures {
    const countRows = (statement: StatementSync) =>
      new Map(
        (statement.all(sinceIso) as unknown as Array<{ day: string; amount: number }>).map(
          (row) => [row.day, Number(row.amount)],
        ),
      );
    return {
      tasksDone: countRows(this.doneByDayStatement),
      tokens: countRows(this.tokensByDayStatement),
      qcGates: new Map(
        (
          this.qcByDayStatement.all(sinceIso) as unknown as Array<{
            day: string;
            passed: number;
            total: number;
          }>
        ).map((row) => [row.day, { passed: Number(row.passed), total: Number(row.total) }]),
      ),
    };
  }

  countAgents(): { total: number; enabled: number; working: number } {
    const row = this.agentsStatement.get() as {
      total: number;
      enabled: number | null;
      working: number;
    };
    return {
      total: Number(row.total),
      enabled: Number(row.enabled ?? 0),
      working: Number(row.working),
    };
  }

  sumApiCostUsd(sinceIso: string): number {
    return Number((this.apiCostStatement.get(sinceIso) as { cost: number }).cost);
  }

  readHourlyThroughput(sinceIso: string): Map<number, { done: number; reworked: number }> {
    const rows = this.hourlyStatement.all(sinceIso) as unknown as Array<{
      hour: number;
      done: number;
      reworked: number;
    }>;
    return new Map(
      rows.map((row) => [
        Number(row.hour),
        { done: Number(row.done), reworked: Number(row.reworked) },
      ]),
    );
  }

  readUsageByProvider(
    sinceIso: string,
  ): Array<{ provider: AgentProvider; tokens: number; turns: number; costUsd: number }> {
    return (
      this.usageByProviderStatement.all(sinceIso) as unknown as Array<{
        provider: AgentProvider;
        tokens: number;
        turns: number;
        cost: number;
      }>
    ).map((row) => ({
      provider: row.provider,
      tokens: Number(row.tokens),
      turns: Number(row.turns),
      costUsd: Number(row.cost),
    }));
  }

  listRecentActivity(limit: number): ActivityRecord[] {
    return (
      this.activityStatement.all(limit) as unknown as Array<{
        id: number;
        kind: string;
        agent_name: string | null;
        task_id: string;
        sequence_number: number;
        title: string;
        payload_json: string;
        created_at: string;
      }>
    ).map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      agentName: row.agent_name,
      taskId: row.task_id,
      taskSequenceNumber: Number(row.sequence_number),
      taskTitle: row.title,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }
}
