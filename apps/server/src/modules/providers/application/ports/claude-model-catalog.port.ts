import type { LocalEngineModelChoice } from '@aiteam/contracts';

export const CLAUDE_MODEL_CATALOG = Symbol('CLAUDE_MODEL_CATALOG');

/** The models the installed Claude Code offers to pick from (its own list, 0 tokens). */
export interface ClaudeModelCatalog {
  /** Throws an AppError when the CLI is missing or its list cannot be read. */
  listClaudeModels(): Promise<LocalEngineModelChoice[]>;
}
