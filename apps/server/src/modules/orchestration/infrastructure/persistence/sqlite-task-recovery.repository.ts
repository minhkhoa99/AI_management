import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { TaskRecoveryRepository } from '../../domain/repositories/task-recovery.repository';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

@Injectable()
export class SqliteTaskRecoveryRepository implements TaskRecoveryRepository {
  private readonly requeueStatement: StatementSync;
  private readonly finishCancellingStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.requeueStatement = database.prepare(
      `UPDATE tasks SET status = 'queued', updated_at = ${NOW} WHERE status = 'running'`,
    );
    this.finishCancellingStatement = database.prepare(
      `UPDATE tasks SET status = 'cancelled', updated_at = ${NOW} WHERE status = 'cancelling'`,
    );
  }

  requeueRunningTasks(): number {
    return Number(this.requeueStatement.run().changes);
  }

  finishCancellingTasks(): number {
    return Number(this.finishCancellingStatement.run().changes);
  }
}
