import { Inject, Injectable } from '@nestjs/common';
import type { LocalEngine, LocalEngineModelChoice, LocalEngineModelList } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import { CLAUDE_CODE_MODEL_CHOICES } from '../../domain/claude-code-models';
import { CODEX_MODEL_CATALOG, type CodexModelCatalog } from '../ports/codex-model-catalog.port';

/** Reading the Codex catalog spawns the CLI (~1 s); forms open often, models change rarely. */
export const CODEX_CATALOG_CACHE_MS = 10 * 60 * 1000;

/** Quick picks for the model picker of agents on Claude Code / Codex. */
@Injectable()
export class ListLocalEngineModelsUseCase {
  private cachedCodexModels: {
    expiresAt: number;
    models: Promise<LocalEngineModelChoice[]>;
  } | null = null;

  constructor(@Inject(CODEX_MODEL_CATALOG) private readonly codexModelCatalog: CodexModelCatalog) {}

  async listLocalEngineModels(engine: LocalEngine): Promise<LocalEngineModelList> {
    if (engine === 'claude_code') {
      return { models: [...CLAUDE_CODE_MODEL_CHOICES], problem: null };
    }
    try {
      return { models: await this.readCodexModels(), problem: null };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      // The owner can still type any model name; the picker shows why the list is empty.
      return { models: [], problem: error.message };
    }
  }

  private readCodexModels(): Promise<LocalEngineModelChoice[]> {
    const cached = this.cachedCodexModels;
    if (cached !== null && cached.expiresAt > Date.now()) {
      return cached.models;
    }
    const models = this.codexModelCatalog.listCodexModels();
    this.cachedCodexModels = { expiresAt: Date.now() + CODEX_CATALOG_CACHE_MS, models };
    // A failure is not cached: the next form opening tries again (e.g. after `codex login`).
    models.catch(() => {
      if (this.cachedCodexModels?.models === models) {
        this.cachedCodexModels = null;
      }
    });
    return models;
  }
}
