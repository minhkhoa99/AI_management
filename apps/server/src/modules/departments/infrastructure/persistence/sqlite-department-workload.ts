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
  private readonly countHandoffStepsStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.countDepartmentTasksStatement = database.prepare(
      'SELECT COUNT(*) AS row_count FROM tasks WHERE department_id = ?',
    );
    this.countAgentTasksStatement = database.prepare(
      `SELECT COUNT(*) AS row_count FROM tasks
       WHERE assignee_agent_id = ? AND status NOT IN (${FINISHED_LIST})`,
    );
    this.countHandoffStepsStatement = database.prepare(
      'SELECT COUNT(*) AS row_count FROM workflow_steps WHERE handoff_department_id = ?',
    );
  }

  countTasksOfDepartment(departmentId: string): number {
    return readCount(this.countDepartmentTasksStatement.get(departmentId));
  }

  countUnfinishedTasksOfAgent(agentId: string): number {
    return readCount(this.countAgentTasksStatement.get(agentId));
  }

  countHandoffStepsTargeting(departmentId: string): number {
    return readCount(this.countHandoffStepsStatement.get(departmentId));
  }
}

function readCount(row: unknown): number {
  return Number((row as { row_count: number } | undefined)?.row_count ?? 0);
}
