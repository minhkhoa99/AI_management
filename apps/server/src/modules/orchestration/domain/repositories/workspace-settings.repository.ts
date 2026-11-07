export const WORKSPACE_SETTINGS_REPOSITORY = Symbol('WORKSPACE_SETTINGS_REPOSITORY');

export interface WorkspaceSettingsRepository {
  /** In the order they were added. */
  listAllowedDirectories(): string[];
  addAllowedDirectory(directoryPath: string): void;
  removeAllowedDirectory(directoryPath: string): void;
  readMaxParallelAgents(): number;
  saveMaxParallelAgents(maxParallelAgents: number): void;
}
