import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiFormat } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import { ProviderConnection } from '../../domain/entities/provider-connection';
import type { ProviderConnectionRepository } from '../../domain/repositories/provider-connection.repository';

interface ProviderConnectionRow {
  id: string;
  name: string;
  format: ApiFormat;
  base_url: string;
  encrypted_key: string | null;
  key_hint: string | null;
  models_json: string;
  default_model: string | null;
}

const CONNECTION_COLUMNS =
  'id, name, format, base_url, encrypted_key, key_hint, models_json, default_model';

@Injectable()
export class SqliteProviderConnectionRepository implements ProviderConnectionRepository {
  private readonly selectAllStatement: StatementSync;
  private readonly selectByIdStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly deleteStatement: StatementSync;
  private readonly selectAgentNamesStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectAllStatement = database.prepare(
      `SELECT ${CONNECTION_COLUMNS} FROM provider_connections ORDER BY rowid`,
    );
    this.selectByIdStatement = database.prepare(
      `SELECT ${CONNECTION_COLUMNS} FROM provider_connections WHERE id = ?`,
    );
    this.insertStatement = database.prepare(
      `INSERT INTO provider_connections (${CONNECTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateStatement = database.prepare(
      `UPDATE provider_connections SET name = ?, format = ?, base_url = ?, encrypted_key = ?,
         key_hint = ?, models_json = ?, default_model = ? WHERE id = ?`,
    );
    this.deleteStatement = database.prepare('DELETE FROM provider_connections WHERE id = ?');
    this.selectAgentNamesStatement = database.prepare(
      'SELECT connection_id, name FROM agents WHERE connection_id IS NOT NULL ORDER BY rowid',
    );
  }

  listProviderConnections(): ProviderConnection[] {
    return (this.selectAllStatement.all() as unknown as ProviderConnectionRow[]).map(
      restoreConnection,
    );
  }

  findProviderConnectionById(connectionId: string): ProviderConnection | undefined {
    const row = this.selectByIdStatement.get(connectionId) as ProviderConnectionRow | undefined;
    return row === undefined ? undefined : restoreConnection(row);
  }

  insertProviderConnection(connection: ProviderConnection): void {
    const state = connection.toState();
    this.insertStatement.run(
      state.id,
      state.name,
      state.format,
      state.baseUrl,
      state.encryptedKey,
      state.keyHint,
      JSON.stringify(state.models),
      state.defaultModel,
    );
  }

  updateProviderConnection(connection: ProviderConnection): void {
    const state = connection.toState();
    this.updateStatement.run(
      state.name,
      state.format,
      state.baseUrl,
      state.encryptedKey,
      state.keyHint,
      JSON.stringify(state.models),
      state.defaultModel,
      state.id,
    );
  }

  deleteProviderConnection(connectionId: string): void {
    this.deleteStatement.run(connectionId);
  }

  listAgentNamesPerConnection(): Map<string, string[]> {
    const namesPerConnection = new Map<string, string[]>();
    const rows = this.selectAgentNamesStatement.all() as unknown as Array<{
      connection_id: string;
      name: string;
    }>;
    for (const row of rows) {
      namesPerConnection.set(row.connection_id, [
        ...(namesPerConnection.get(row.connection_id) ?? []),
        row.name,
      ]);
    }
    return namesPerConnection;
  }
}

function restoreConnection(row: ProviderConnectionRow): ProviderConnection {
  return ProviderConnection.restore({
    id: row.id,
    name: row.name,
    format: row.format,
    baseUrl: row.base_url,
    encryptedKey: row.encrypted_key,
    keyHint: row.key_hint,
    models: JSON.parse(row.models_json) as string[],
    defaultModel: row.default_model,
  });
}
