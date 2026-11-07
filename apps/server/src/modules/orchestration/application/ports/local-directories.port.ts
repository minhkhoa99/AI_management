export const DIRECTORY_INSPECTOR = Symbol('DIRECTORY_INSPECTOR');

export interface DirectoryFacts {
  /** Absolute, "~" expanded, symlinks resolved when the folder exists. */
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  /** Inside a git work tree (any parent folder may hold the .git). */
  isGitRepository: boolean;
}

export interface DirectoryInspector {
  inspectDirectory(rawPath: string): Promise<DirectoryFacts>;
  /** Same comparison rules as the file system (case-insensitive on Windows and macOS). */
  isInsideDirectory(candidatePath: string, parentPath: string): boolean;
}
