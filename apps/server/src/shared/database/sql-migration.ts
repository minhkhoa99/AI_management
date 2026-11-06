/** One numbered, forward-only schema change. Applied once, inside its own transaction. */
export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
  /**
   * Set for migrations that rebuild tables (create new, copy, drop old, rename). Foreign keys are
   * switched off around the transaction so dropping a parent table does not cascade into its
   * children; `PRAGMA foreign_key_check` must pass before commit. (SQLite "12-step" procedure:
   * the pragma cannot change inside a transaction.)
   */
  rebuildsTables?: boolean;
}
