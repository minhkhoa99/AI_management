import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Inject, Injectable } from '@nestjs/common';
import { SQLITE_DATABASE } from '../../../../shared/database/sqlite-connection';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../shared/database/transaction-runner';
import type {
  CodeImportEdge,
  CodeIndexRepository,
  IndexedCodeFile,
  IndexedCodeFileUpdate,
} from '../../domain/repositories/code-index.repository';

interface CodeFileRow {
  path: string;
  blob_sha: string;
  exported_names: string;
  search_terms: string;
}

@Injectable()
export class SqliteCodeIndexRepository implements CodeIndexRepository {
  private readonly listFilesStatement: StatementSync;
  private readonly listImportsStatement: StatementSync;
  private readonly fileIndexedStatement: StatementSync;
  private readonly upsertFileStatement: StatementSync;
  private readonly clearOwnImportsStatement: StatementSync;
  private readonly insertImportStatement: StatementSync;
  private readonly deleteFileStatement: StatementSync;
  private readonly deleteImportsOfPathStatement: StatementSync;

  constructor(
    @Inject(SQLITE_DATABASE) database: DatabaseSync,
    @Inject(TRANSACTION_RUNNER) private readonly transactionRunner: TransactionRunner,
  ) {
    this.listFilesStatement = database.prepare(
      `SELECT path, blob_sha, exported_names, search_terms FROM code_files
        WHERE project_key = ? ORDER BY path`,
    );
    this.listImportsStatement = database.prepare(
      'SELECT from_path, to_path FROM code_imports WHERE project_key = ? ORDER BY from_path, to_path',
    );
    this.fileIndexedStatement = database.prepare(
      'SELECT 1 FROM code_files WHERE project_key = ? AND path = ?',
    );
    this.upsertFileStatement = database.prepare(
      `INSERT INTO code_files (project_key, path, blob_sha, exported_names, search_terms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_key, path) DO UPDATE SET blob_sha = excluded.blob_sha,
         exported_names = excluded.exported_names, search_terms = excluded.search_terms`,
    );
    this.clearOwnImportsStatement = database.prepare(
      'DELETE FROM code_imports WHERE project_key = ? AND from_path = ?',
    );
    this.insertImportStatement = database.prepare(
      'INSERT OR IGNORE INTO code_imports (project_key, from_path, to_path) VALUES (?, ?, ?)',
    );
    this.deleteFileStatement = database.prepare(
      'DELETE FROM code_files WHERE project_key = ? AND path = ?',
    );
    this.deleteImportsOfPathStatement = database.prepare(
      'DELETE FROM code_imports WHERE project_key = ? AND (from_path = ? OR to_path = ?)',
    );
  }

  listFileShas(projectKey: string): Map<string, string> {
    return new Map(this.listFiles(projectKey).map((file) => [file.path, file.blobSha]));
  }

  listFiles(projectKey: string): IndexedCodeFile[] {
    return (this.listFilesStatement.all(projectKey) as unknown as CodeFileRow[]).map((row) => ({
      path: row.path,
      blobSha: row.blob_sha,
      exportedNames: JSON.parse(row.exported_names) as string[],
      searchTerms: row.search_terms === '' ? [] : row.search_terms.split(' '),
    }));
  }

  listImports(projectKey: string): CodeImportEdge[] {
    return (
      this.listImportsStatement.all(projectKey) as unknown as Array<{
        from_path: string;
        to_path: string;
      }>
    ).map((row) => ({ fromPath: row.from_path, toPath: row.to_path }));
  }

  isFileIndexed(projectKey: string, path: string): boolean {
    return this.fileIndexedStatement.get(projectKey, path) !== undefined;
  }

  applyIndexChanges(
    projectKey: string,
    updates: readonly IndexedCodeFileUpdate[],
    removedPaths: readonly string[],
  ): void {
    this.transactionRunner.runInTransaction(() => {
      for (const file of updates) {
        this.upsertFileStatement.run(
          projectKey,
          file.path,
          file.blobSha,
          JSON.stringify(file.exportedNames),
          file.searchTerms.join(' '),
        );
        this.clearOwnImportsStatement.run(projectKey, file.path);
        for (const importedPath of file.importedPaths) {
          this.insertImportStatement.run(projectKey, file.path, importedPath);
        }
      }
      for (const removedPath of removedPaths) {
        this.deleteFileStatement.run(projectKey, removedPath);
        this.deleteImportsOfPathStatement.run(projectKey, removedPath, removedPath);
      }
    });
  }
}
