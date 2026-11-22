import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  WorkflowRunHistory,
  WorkflowRunHistoryQuery,
} from '../../application/ports/workflow-run-history.query';

const RECENT_TASK_LIMIT = 100;

interface EventRow {
  task_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
}

@Injectable()
export class SqliteWorkflowRunHistoryQuery implements WorkflowRunHistoryQuery {
  private readonly recentTasksStatement: StatementSync;
  private readonly eventsStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.recentTasksStatement = database.prepare(
      `SELECT id FROM tasks
       WHERE workflow_id = ? AND status IN ('succeeded', 'failed', 'cancelled')
       ORDER BY created_at DESC, rowid DESC LIMIT ${RECENT_TASK_LIMIT}`,
    );
    this.eventsStatement = database.prepare(
      `SELECT task_id, kind, payload_json, created_at FROM task_events
       WHERE task_id IN (SELECT value FROM json_each(?))
         AND kind IN ('turn_started', 'step_report', 'step_passed', 'step_retried',
                      'step_returned', 'task_succeeded', 'task_failed', 'engine_failed')
       ORDER BY task_id, id`,
    );
  }

  listWorkflowRunHistory(workflowId: string): WorkflowRunHistory {
    const taskIds = (
      this.recentTasksStatement.all(workflowId) as unknown as Array<{ id: string }>
    ).map((row) => row.id);
    const rows = this.eventsStatement.all(JSON.stringify(taskIds)) as unknown as EventRow[];
    return {
      finishedTaskCount: taskIds.length,
      events: rows.map((row) => ({
        taskId: row.task_id,
        kind: row.kind,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        createdAt: row.created_at,
      })),
    };
  }
}
