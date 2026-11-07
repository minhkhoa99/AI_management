import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { FINISHED_TASK_STATUSES } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { WorkflowTaskUsage } from '../../domain/repositories/workflow-task-usage.repository';

const UNFINISHED_CONDITION = `status NOT IN (${FINISHED_TASK_STATUSES.map((status) => `'${status}'`).join(', ')})`;

@Injectable()
export class SqliteWorkflowTaskUsage implements WorkflowTaskUsage {
  private readonly countPerWorkflowStatement: StatementSync;
  private readonly countUnfinishedOfWorkflowStatement: StatementSync;
  private readonly countUnfinishedOnStepsStatement: StatementSync;
  private readonly moveTasksStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.countPerWorkflowStatement = database.prepare(
      `SELECT workflow_id, COUNT(*) AS task_count FROM tasks
       WHERE department_id = ? AND workflow_id IS NOT NULL GROUP BY workflow_id`,
    );
    this.countUnfinishedOfWorkflowStatement = database.prepare(
      `SELECT COUNT(*) AS task_count FROM tasks WHERE workflow_id = ? AND ${UNFINISHED_CONDITION}`,
    );
    this.countUnfinishedOnStepsStatement = database.prepare(
      `SELECT COUNT(*) AS task_count FROM tasks
       WHERE current_step_id IN (SELECT value FROM json_each(?)) AND ${UNFINISHED_CONDITION}`,
    );
    this.moveTasksStatement = database.prepare(
      `UPDATE tasks SET workflow_id = ?, current_step_id = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE workflow_id = ?`,
    );
  }

  countTasksPerWorkflow(departmentId: string): Map<string, number> {
    const rows = this.countPerWorkflowStatement.all(departmentId) as unknown as Array<{
      workflow_id: string;
      task_count: number;
    }>;
    return new Map(rows.map((row) => [row.workflow_id, Number(row.task_count)]));
  }

  countUnfinishedTasksOfWorkflow(workflowId: string): number {
    return readCount(this.countUnfinishedOfWorkflowStatement.get(workflowId));
  }

  countUnfinishedTasksOnSteps(stepIds: readonly string[]): number {
    if (stepIds.length === 0) {
      return 0;
    }
    return readCount(this.countUnfinishedOnStepsStatement.get(JSON.stringify(stepIds)));
  }

  moveTasksToWorkflow(fromWorkflowId: string, toWorkflowId: string): void {
    this.moveTasksStatement.run(toWorkflowId, fromWorkflowId);
  }
}

function readCount(row: unknown): number {
  return Number((row as { task_count: number } | undefined)?.task_count ?? 0);
}
