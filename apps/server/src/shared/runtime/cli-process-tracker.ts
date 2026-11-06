import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { IdGenerator } from '../identifiers/id-generator';
import type { AppLogger } from '../logging/app-logger';
import { normaliseProcessName, type ProcessInspector } from './process-identity';

export const CLI_PROCESS_TRACKER = Symbol('CLI_PROCESS_TRACKER');

export interface CliProcessRecord {
  id: string;
  pid: number;
  processName: string;
  processStartedAt: string | null;
}

export interface CliProcessTracker {
  /** Records a spawned CLI; returns the function to call once it has exited. */
  recordSpawnedProcess(pid: number, executablePath: string): () => void;
  listRecordedProcesses(): CliProcessRecord[];
  forgetRecordedProcess(recordId: string): void;
}

/**
 * Persists running CLI processes (table cli_process_records) so the next start can clean up
 * after a crash. The start time is read asynchronously right after spawn; if it cannot be read
 * the record stays without it and will never be killed automatically.
 */
export class SqliteCliProcessTracker implements CliProcessTracker {
  private readonly insertStatement: StatementSync;
  private readonly setStartTimeStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly selectAllStatement: StatementSync;

  constructor(
    database: DatabaseSync,
    private readonly processInspector: ProcessInspector,
    private readonly idGenerator: IdGenerator,
    private readonly logger: AppLogger,
  ) {
    this.insertStatement = database.prepare(
      'INSERT INTO cli_process_records (id, pid, process_name) VALUES (?, ?, ?)',
    );
    this.setStartTimeStatement = database.prepare(
      'UPDATE cli_process_records SET process_started_at = ? WHERE id = ?',
    );
    this.deleteStatement = database.prepare('DELETE FROM cli_process_records WHERE id = ?');
    this.selectAllStatement = database.prepare(
      'SELECT id, pid, process_name, process_started_at FROM cli_process_records ORDER BY recorded_at',
    );
  }

  recordSpawnedProcess(pid: number, executablePath: string): () => void {
    const recordId = this.idGenerator.generateId();
    const processName = normaliseProcessName(executablePath);
    this.insertStatement.run(recordId, pid, processName);
    let exited = false;
    void this.captureStartTime(recordId, pid, processName, () => exited);
    return () => {
      exited = true;
      this.forgetRecordedProcess(recordId);
    };
  }

  listRecordedProcesses(): CliProcessRecord[] {
    const rows = this.selectAllStatement.all() as unknown as Array<{
      id: string;
      pid: number;
      process_name: string;
      process_started_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      pid: Number(row.pid),
      processName: row.process_name,
      processStartedAt: row.process_started_at,
    }));
  }

  forgetRecordedProcess(recordId: string): void {
    this.deleteStatement.run(recordId);
  }

  /** Never rejects: a failure only leaves the record without a start time (logged). */
  private async captureStartTime(
    recordId: string,
    pid: number,
    expectedName: string,
    hasExited: () => boolean,
  ): Promise<void> {
    try {
      const identity = await this.processInspector.inspectProcess(pid);
      if (hasExited() || identity === null || identity.name !== expectedName) {
        return;
      }
      this.setStartTimeStatement.run(identity.startedAt, recordId);
    } catch (error) {
      this.logger.warn({ err: error, pid }, 'could not read CLI process start time');
    }
  }
}
