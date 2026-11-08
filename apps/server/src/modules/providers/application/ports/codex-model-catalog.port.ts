import type { LocalEngineModelChoice } from '@aiteam/contracts';

export const CODEX_MODEL_CATALOG = Symbol('CODEX_MODEL_CATALOG');

/** The models the installed Codex CLI offers to pick from (its own catalog, kept fresh by Codex). */
export interface CodexModelCatalog {
  /** Throws an AppError when the CLI is missing or its catalog cannot be read. */
  listCodexModels(): Promise<LocalEngineModelChoice[]>;
}
