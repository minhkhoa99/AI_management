import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { ProviderConnectionLookup } from '../../application/ports/provider-connection-lookup.port';

@Injectable()
export class SqliteProviderConnectionLookup implements ProviderConnectionLookup {
  private readonly selectExistsStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectExistsStatement = database.prepare(
      'SELECT 1 AS found FROM provider_connections WHERE id = ?',
    );
  }

  connectionExists(connectionId: string): boolean {
    return this.selectExistsStatement.get(connectionId) !== undefined;
  }
}
