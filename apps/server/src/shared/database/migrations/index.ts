import type { SqlMigration } from '../sql-migration';
import { initialSchemaMigration } from './001-initial-schema';
import constrainEnumerationsSql from './002_constrain_enumerations.sql';
import organizationRulesSql from './003_organization_rules.sql';
import engineSettingsSql from './004_engine_settings.sql';
import cliProcessRecordsSql from './005_cli_process_records.sql';

/** Every schema migration, in ascending version order. Append only; never edit a released one. */
export const ALL_MIGRATIONS: readonly SqlMigration[] = [
  initialSchemaMigration,
  {
    version: 2,
    name: 'constrain-enumerations',
    sql: constrainEnumerationsSql,
    rebuildsTables: true,
  },
  {
    version: 3,
    name: 'organization-rules',
    sql: organizationRulesSql,
    rebuildsTables: true,
  },
  { version: 4, name: 'engine-settings', sql: engineSettingsSql },
  { version: 5, name: 'cli-process-records', sql: cliProcessRecordsSql },
];
