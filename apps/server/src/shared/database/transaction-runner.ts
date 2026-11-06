import type { DatabaseSync } from 'node:sqlite';

export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

/** Runs synchronous repository work atomically: all of it commits, or none of it does. */
export interface TransactionRunner {
  runInTransaction<T>(work: () => T): T;
}

/**
 * SQLite implementation using SAVEPOINTs, so a use case may call another transactional unit
 * without "cannot start a transaction within a transaction" errors.
 */
export class SqliteTransactionRunner implements TransactionRunner {
  private savepointDepth = 0;

  constructor(private readonly database: DatabaseSync) {}

  runInTransaction<T>(work: () => T): T {
    this.savepointDepth += 1;
    const savepointName = `unit_of_work_${this.savepointDepth}`;
    this.database.exec(`SAVEPOINT ${savepointName}`);
    try {
      const result = work();
      this.database.exec(`RELEASE ${savepointName}`);
      return result;
    } catch (error) {
      this.database.exec(`ROLLBACK TO ${savepointName}`);
      this.database.exec(`RELEASE ${savepointName}`);
      throw error;
    } finally {
      this.savepointDepth -= 1;
    }
  }
}
