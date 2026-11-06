/** One numbered, forward-only schema change. Applied once, inside its own transaction. */
export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
}
