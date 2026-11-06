import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import type { LocalEngine, LocalEngineSettings } from '@aiteam/contracts';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { LocalEngineSettingsRepository } from '../../domain/repositories/local-engine-settings.repository';

interface LocalEngineSettingsRow {
  default_model: string | null;
  block_dangerous_commands: number;
  allow_network: number;
}

/** Rows for every engine are seeded by migration 004. */
@Injectable()
export class SqliteLocalEngineSettingsRepository implements LocalEngineSettingsRepository {
  private readonly selectStatement: StatementSync;
  private readonly updateStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectStatement = database.prepare(
      'SELECT default_model, block_dangerous_commands, allow_network FROM local_engine_settings WHERE engine = ?',
    );
    this.updateStatement = database.prepare(
      `UPDATE local_engine_settings
         SET default_model = ?, block_dangerous_commands = ?, allow_network = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE engine = ?`,
    );
  }

  readLocalEngineSettings(engine: LocalEngine): LocalEngineSettings {
    const row = this.selectStatement.get(engine) as LocalEngineSettingsRow | undefined;
    if (row === undefined) {
      throw new Error(`local_engine_settings has no row for ${engine}; migration 004 seeds it`);
    }
    return {
      defaultModel: row.default_model,
      blockDangerousCommands: row.block_dangerous_commands === 1,
      allowNetwork: row.allow_network === 1,
    };
  }

  saveLocalEngineSettings(engine: LocalEngine, settings: LocalEngineSettings): void {
    this.updateStatement.run(
      settings.defaultModel,
      Number(settings.blockDangerousCommands),
      Number(settings.allowNetwork),
      engine,
    );
  }
}
