import type { LocalEngineModelChoice } from '@aiteam/contracts';

export const ANTIGRAVITY_MODEL_CATALOG = Symbol('ANTIGRAVITY_MODEL_CATALOG');

/** The models the installed Antigravity CLI (`agy`) offers to pick from. */
export interface AntigravityModelCatalog {
  /** Throws an AppError when the CLI is missing or its list cannot be read. */
  listAntigravityModels(): Promise<LocalEngineModelChoice[]>;
}
