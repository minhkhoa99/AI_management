import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type {
  InterruptionNotice,
  TaskRecoveryRepository,
} from '../../domain/repositories/task-recovery.repository';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

@Injectable()
export class SqliteTaskRecoveryRepository implements TaskRecoveryRepository {
  private readonly requeueStatement: StatementSync;
  private readonly finishCancellingStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.requeueStatement = database.prepare(
      `UPDATE tasks
          SET status = 'queued',
              status_note = :statusNote,
              run_after = NULL,
              pending_feedback = substr(
                CASE WHEN pending_feedback IS NULL OR pending_feedback = '' THEN :agentFeedback
                     ELSE pending_feedback || char(10) || char(10) || :agentFeedback END,
                -:feedbackMaxLength),
              updated_at = ${NOW}
        WHERE status = 'running'`,
    );
    this.finishCancellingStatement = database.prepare(
      `UPDATE tasks SET status = 'cancelled', updated_at = ${NOW} WHERE status = 'cancelling'`,
    );
  }

  requeueRunningTasks(notice: InterruptionNotice): number {
    return Number(
      this.requeueStatement.run({
        statusNote: notice.statusNote,
        agentFeedback: notice.agentFeedback,
        feedbackMaxLength: notice.feedbackMaxLength,
      }).changes,
    );
  }

  finishCancellingTasks(): number {
    return Number(this.finishCancellingStatement.run().changes);
  }
}
