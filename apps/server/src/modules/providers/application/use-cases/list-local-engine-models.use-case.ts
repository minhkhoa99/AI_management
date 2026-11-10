import { Inject, Injectable } from '@nestjs/common';
import type { LocalEngine, LocalEngineModelChoice, LocalEngineModelList } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import { CLAUDE_CODE_MODEL_CHOICES } from '../../domain/claude-code-models';
import {
  ANTIGRAVITY_MODEL_CATALOG,
  type AntigravityModelCatalog,
} from '../ports/antigravity-model-catalog.port';
import { CODEX_MODEL_CATALOG, type CodexModelCatalog } from '../ports/codex-model-catalog.port';

/** Reading a CLI catalog spawns the CLI (~1 s); forms open often, models change rarely. */
export const ENGINE_CATALOG_CACHE_MS = 10 * 60 * 1000;

type CatalogEngine = 'codex' | 'antigravity';

/** Quick picks for the model picker of agents on Claude Code / Codex / Antigravity. */
@Injectable()
export class ListLocalEngineModelsUseCase {
  private readonly cachedCatalogs = new Map<
    CatalogEngine,
    { expiresAt: number; models: Promise<LocalEngineModelChoice[]> }
  >();

  constructor(
    @Inject(CODEX_MODEL_CATALOG) private readonly codexModelCatalog: CodexModelCatalog,
    @Inject(ANTIGRAVITY_MODEL_CATALOG)
    private readonly antigravityModelCatalog: AntigravityModelCatalog,
  ) {}

  async listLocalEngineModels(engine: LocalEngine): Promise<LocalEngineModelList> {
    if (engine === 'claude_code') {
      return { models: [...CLAUDE_CODE_MODEL_CHOICES], problem: null };
    }
    try {
      const models =
        engine === 'codex'
          ? await this.readCatalogModels('codex', () => this.codexModelCatalog.listCodexModels())
          : await this.readCatalogModels('antigravity', () =>
              this.antigravityModelCatalog.listAntigravityModels(),
            );
      return { models, problem: null };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      // The owner can still type any model name; the picker shows why the list is empty.
      return { models: [], problem: error.message };
    }
  }

  private readCatalogModels(
    engine: CatalogEngine,
    loadModels: () => Promise<LocalEngineModelChoice[]>,
  ): Promise<LocalEngineModelChoice[]> {
    const cached = this.cachedCatalogs.get(engine);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.models;
    }
    const models = loadModels();
    this.cachedCatalogs.set(engine, { expiresAt: Date.now() + ENGINE_CATALOG_CACHE_MS, models });
    // A failure is not cached: the next form opening tries again (e.g. after `codex login`).
    models.catch(() => {
      if (this.cachedCatalogs.get(engine)?.models === models) {
        this.cachedCatalogs.delete(engine);
      }
    });
    return models;
  }
}
