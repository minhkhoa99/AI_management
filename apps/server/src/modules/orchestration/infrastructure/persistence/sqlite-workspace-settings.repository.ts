import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import type { WorkspaceSettingsRepository } from '../../domain/repositories/workspace-settings.repository';

@Injectable()
export class SqliteWorkspaceSettingsRepository implements WorkspaceSettingsRepository {
  private readonly selectDirectoriesStatement: StatementSync;
  private readonly insertDirectoryStatement: StatementSync;
  private readonly deleteDirectoryStatement: StatementSync;
  private readonly selectParallelStatement: StatementSync;
  private readonly updateParallelStatement: StatementSync;

  constructor(@Inject(SQLITE_DATABASE) database: DatabaseSync) {
    this.selectDirectoriesStatement = database.prepare(
      'SELECT path FROM allowed_directories ORDER BY added_at, rowid',
    );
    this.insertDirectoryStatement = database.prepare(
      'INSERT OR IGNORE INTO allowed_directories (path) VALUES (?)',
    );
    this.deleteDirectoryStatement = database.prepare(
      'DELETE FROM allowed_directories WHERE path = ?',
    );
    this.selectParallelStatement = database.prepare(
      'SELECT max_parallel_agents FROM workspace_settings WHERE id = 1',
    );
    this.updateParallelStatement = database.prepare(
      'UPDATE workspace_settings SET max_parallel_agents = ? WHERE id = 1',
    );
  }

  listAllowedDirectories(): string[] {
    return (this.selectDirectoriesStatement.all() as unknown as Array<{ path: string }>).map(
      (row) => row.path,
    );
  }

  addAllowedDirectory(directoryPath: string): void {
    this.insertDirectoryStatement.run(directoryPath);
  }

  removeAllowedDirectory(directoryPath: string): void {
    this.deleteDirectoryStatement.run(directoryPath);
  }

  readMaxParallelAgents(): number {
    const row = this.selectParallelStatement.get() as { max_parallel_agents: number } | undefined;
    return Number(row?.max_parallel_agents ?? 2);
  }

  saveMaxParallelAgents(maxParallelAgents: number): void {
    this.updateParallelStatement.run(maxParallelAgents);
  }
}
