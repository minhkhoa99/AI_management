import type { SqlMigration } from '../sql-migration';
import { initialSchemaMigration } from './001-initial-schema';

/** Every schema migration, in ascending version order. Append only; never edit a released one. */
export const ALL_MIGRATIONS: readonly SqlMigration[] = [initialSchemaMigration];
