import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import { LiveUpdateHub } from '../../../../shared/events/live-update-hub';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import type {
  StepReportRecord,
  TaskEventLog,
  TaskEventRecord,
} from '../../../orchestration/application/ports/task-execution.ports';
import { describeTaskEvent, describeTaskEventDetail } from '../../domain/describe-task-event';

/** Plan §5.10: events are written in one transaction every 200 ms or every 100 events. */
export const EVENT_FLUSH_INTERVAL_MS = 200;
export const EVENT_FLUSH_BATCH_SIZE = 100;
const STEP_REPORT_KIND = 'step_report';
/** Not shown in task logs or streams (counted by the overview). */
const SILENT_KINDS = new Set(['usage', 'session_started']);

interface PendingTaskEvent {
  taskId: string;
  agentId: string | null;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * The task log (one trace per task). Events are buffered and written in batches; every read
 * flushes first, so callers always see what they recorded. After each batch the new lines are
 * pushed to the live streams. Events of a task deleted meanwhile are dropped.
 */
@Injectable()
export class BatchedTaskEventLog implements TaskEventLog, OnApplicationShutdown {
  private pending: PendingTaskEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly insertStatement: StatementSync;
  private readonly lastIdStatement: StatementSync;
  private readonly reportsStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly taskStatement: StatementSync;
  private readonly agentNameStatement: StatementSync;
  private readonly agentEventsStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    private readonly liveUpdateHub: LiveUpdateHub,
  ) {
    // Each task is one trace: its id is the trace id of every event.
    this.insertStatement = database.prepare(
      `INSERT INTO task_events (task_id, trace_id, agent_id, kind, payload_json)
       SELECT ?1, ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1)`,
    );
    this.lastIdStatement = database.prepare(
      'SELECT id, created_at FROM task_events WHERE rowid = last_insert_rowid()',
    );
    this.reportsStatement = database.prepare(
      `SELECT payload_json FROM task_events WHERE task_id = ? AND kind = '${STEP_REPORT_KIND}' ORDER BY id`,
    );
    this.listStatement = database.prepare(
      `SELECT e.id, e.kind, a.name AS agent_name, e.payload_json, e.created_at
       FROM task_events e LEFT JOIN agents a ON a.id = e.agent_id
       WHERE e.task_id = ? AND e.kind NOT IN ('usage', 'session_started')
       ORDER BY e.id DESC LIMIT ?`,
    );
    this.taskStatement = database.prepare('SELECT department_id FROM tasks WHERE id = ?');
    this.agentNameStatement = database.prepare('SELECT name FROM agents WHERE id = ?');
    this.agentEventsStatement = database.prepare(
      `SELECT e.id, e.kind, a.name AS agent_name, e.payload_json, e.created_at, e.task_id,
              t.sequence_number
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN agents a ON a.id = e.agent_id
       WHERE e.agent_id = ? AND e.kind NOT IN ('usage', 'session_started')
       ORDER BY e.id DESC LIMIT ?`,
    );
  }

  recordTaskEvent(event: PendingTaskEvent): void {
    this.pending.push(event);
    if (this.pending.length >= EVENT_FLUSH_BATCH_SIZE) {
      this.flushPendingEvents();
    } else if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => this.flushOnTimer(), EVENT_FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }

  listStepReports(taskId: string): StepReportRecord[] {
    this.flushPendingEvents();
    const latestByStep = new Map<string, StepReportRecord>();
    for (const row of this.reportsStatement.all(taskId) as unknown as Array<{
      payload_json: string;
    }>) {
      const payload = JSON.parse(row.payload_json) as Partial<StepReportRecord> & {
        stepKey?: string;
      };
      const key = payload.stepKey ?? payload.stepName ?? '';
      latestByStep.delete(key);
      latestByStep.set(key, {
        stepName: payload.stepName ?? '',
        agentName: payload.agentName ?? '',
        summary: payload.summary ?? '',
      });
    }
    return [...latestByStep.values()];
  }

  listTaskEvents(taskId: string, limit: number): TaskEventRecord[] {
    this.flushPendingEvents();
    const rows = this.listStatement.all(taskId, limit) as unknown as Array<{
      id: number;
      kind: string;
      agent_name: string | null;
      payload_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      agentName: row.agent_name,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  /** "Hoạt động" of an agent across all its tasks, newest first. */
  listAgentEvents(
    agentId: string,
    limit: number,
  ): Array<TaskEventRecord & { taskId: string; taskSequenceNumber: number }> {
    this.flushPendingEvents();
    const rows = this.agentEventsStatement.all(agentId, limit) as unknown as Array<{
      id: number;
      kind: string;
      agent_name: string | null;
      payload_json: string;
      created_at: string;
      task_id: string;
      sequence_number: number;
    }>;
    return rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      agentName: row.agent_name,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
      taskId: row.task_id,
      taskSequenceNumber: Number(row.sequence_number),
    }));
  }

  hasTask(taskId: string): boolean {
    return this.taskStatement.get(taskId) !== undefined;
  }

  /** Writes everything buffered in one transaction, then streams the new lines. */
  flushPendingEvents(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const written = this.transactionRunner.runInTransaction(() =>
      batch.flatMap((event) => {
        const result = this.insertStatement.run(
          event.taskId,
          event.agentId,
          event.kind,
          JSON.stringify(event.payload),
        );
        if (Number(result.changes) === 0) return []; // the task was deleted meanwhile
        const row = this.lastIdStatement.get() as { id: number; created_at: string };
        return [{ ...event, id: Number(row.id), createdAt: row.created_at }];
      }),
    );
    for (const event of written) {
      if (SILENT_KINDS.has(event.kind)) continue;
      const task = this.taskStatement.get(event.taskId) as { department_id: string } | undefined;
      const agent =
        event.agentId === null
          ? undefined
          : (this.agentNameStatement.get(event.agentId) as { name: string } | undefined);
      this.liveUpdateHub.publishLiveUpdate({
        type: 'task.event',
        taskId: event.taskId,
        departmentId: task?.department_id ?? null,
        agentId: event.agentId,
        event: {
          id: event.id,
          kind: event.kind,
          agentName: agent?.name ?? null,
          text: describeTaskEvent(event),
          ...describeTaskEventDetail(event),
          createdAt: event.createdAt,
        },
      });
    }
  }

  onApplicationShutdown(): void {
    this.flushOnTimer();
  }

  /** Never throws (runs from a timer): a failed batch is logged, later events still go in. */
  private flushOnTimer(): void {
    try {
      this.flushPendingEvents();
    } catch (error) {
      this.logger.error({ err: error }, 'task events could not be written');
    }
  }
}
