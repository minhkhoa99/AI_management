import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { FINISHED_TASK_STATUSES } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { DepartmentWorkload } from '../../domain/repositories/department-workload.repository';

const FINISHED_LIST = FINISHED_TASK_STATUSES.map((status) => `'${status}'`).join(', ');

@Injectable()
export class SqliteDepartmentWorkload implements DepartmentWorkload {
  private readonly countDepartmentTasksStatement: StatementSync;
  private readonly countAgentTasksStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.countDepartmentTasksStatement = database.prepare(
      'SELECT COUNT(*) AS task_count FROM tasks WHERE department_id = ?',
    );
    this.countAgentTasksStatement = database.prepare(
      `SELECT COUNT(*) AS task_count FROM tasks
       WHERE assignee_agent_id = ? AND status NOT IN (${FINISHED_LIST})`,
    );
  }

  countTasksOfDepartment(departmentId: string): number {
    return readCount(this.countDepartmentTasksStatement.get(departmentId));
  }

  countUnfinishedTasksOfAgent(agentId: string): number {
    return readCount(this.countAgentTasksStatement.get(agentId));
  }
}

function readCount(row: unknown): number {
  return Number((row as { task_count: number } | undefined)?.task_count ?? 0);
}
