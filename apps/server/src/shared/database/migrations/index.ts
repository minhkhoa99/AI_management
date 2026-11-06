import type { SqlMigration } from '../sql-migration';
import { initialSchemaMigration } from './001-initial-schema';
import constrainEnumerationsSql from './002_constrain_enumerations.sql';

/** Every schema migration, in ascending version order. Append only; never edit a released one. */
export const ALL_MIGRATIONS: readonly SqlMigration[] = [
  initialSchemaMigration,
  {
    version: 2,
    name: 'constrain-enumerations',
    sql: constrainEnumerationsSql,
    rebuildsTables: true,
  },
];
