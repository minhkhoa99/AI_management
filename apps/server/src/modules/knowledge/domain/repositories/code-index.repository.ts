export const CODE_INDEX_REPOSITORY = Symbol('CODE_INDEX_REPOSITORY');

/** One indexed file of a repository (project_key = repository root). */
export interface IndexedCodeFile {
  path: string;
  blobSha: string;
  exportedNames: string[];
  /** Search tokens of the path and exported names. */
  searchTerms: string[];
}

/** A file read again this turn, with the indexed files it imports. */
export interface IndexedCodeFileUpdate extends IndexedCodeFile {
  importedPaths: string[];
}

export interface CodeImportEdge {
  fromPath: string;
  toPath: string;
}

export interface CodeIndexRepository {
  /** path -> blob sha of every indexed file of the repository. */
  listFileShas(projectKey: string): Map<string, string>;
  /** Sorted by path. */
  listFiles(projectKey: string): IndexedCodeFile[];
  listImports(projectKey: string): CodeImportEdge[];
  isFileIndexed(projectKey: string, path: string): boolean;
  /**
   * In one transaction: replaces each updated file and its own imports, and removes the
   * removed paths with every import from or to them. Other rows stay as they are.
   */
  applyIndexChanges(
    projectKey: string,
    updates: readonly IndexedCodeFileUpdate[],
    removedPaths: readonly string[],
  ): void;
}
