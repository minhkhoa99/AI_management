import { Inject, Injectable } from '@nestjs/common';
import type { LocalEngine, LocalEngineModelChoice, LocalEngineModelList } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import { CLAUDE_CODE_MODEL_CHOICES } from '../../domain/claude-code-models';
import {
  ANTIGRAVITY_MODEL_CATALOG,
  type AntigravityModelCatalog,
} from '../ports/antigravity-model-catalog.port';
import { CLAUDE_MODEL_CATALOG, type ClaudeModelCatalog } from '../ports/claude-model-catalog.port';
import { CLI_UPDATE_CHECKER, type CliUpdateChecker } from '../ports/cli-update-checker.port';
import { CODEX_MODEL_CATALOG, type CodexModelCatalog } from '../ports/codex-model-catalog.port';

/** Reading a list spawns the CLI (~1 s): forms opening in a row share one read. */
export const ENGINE_CATALOG_CACHE_MS = 60 * 1000;

interface CachedModelList {
  expiresAt: number;
  list: LocalEngineModelList;
}

/** The model picker's quick picks for agents on Claude Code / Codex / Antigravity. */
@Injectable()
export class ListLocalEngineModelsUseCase {
  private readonly cachedLists = new Map<LocalEngine, CachedModelList>();
  private readonly readsInFlight = new Map<LocalEngine, Promise<LocalEngineModelList>>();
  /** The last list read successfully, shown (with the problem) when a later read fails. */
  private readonly lastReadModels = new Map<LocalEngine, LocalEngineModelChoice[]>();

  constructor(
    @Inject(CLAUDE_MODEL_CATALOG) private readonly claudeModelCatalog: ClaudeModelCatalog,
    @Inject(CODEX_MODEL_CATALOG) private readonly codexModelCatalog: CodexModelCatalog,
    @Inject(ANTIGRAVITY_MODEL_CATALOG)
    private readonly antigravityModelCatalog: AntigravityModelCatalog,
    @Inject(CLI_UPDATE_CHECKER) private readonly cliUpdateChecker: CliUpdateChecker,
  ) {}

  /** `refresh` skips the cache (the ↻ button) but still joins a read already running. */
  listLocalEngineModels(
    engine: LocalEngine,
    options: { refresh: boolean } = { refresh: false },
  ): Promise<LocalEngineModelList> {
    const cached = this.cachedLists.get(engine);
    if (!options.refresh && cached !== undefined && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.list);
    }
    const running = this.readsInFlight.get(engine);
    if (running !== undefined) return running;
    const read = this.readModelList(engine).finally(() => this.readsInFlight.delete(engine));
    this.readsInFlight.set(engine, read);
    return read;
  }

  private async readModelList(engine: LocalEngine): Promise<LocalEngineModelList> {
    const [modelsOrProblem, cliUpdate] = await Promise.all([
      this.readCatalogModels(engine).then(
        (models) => ({ models, problem: null }),
        (error: unknown) => {
          if (!(error instanceof AppError)) throw error;
          return { models: null, problem: error.message };
        },
      ),
      engine === 'antigravity'
        ? Promise.resolve(null)
        : this.cliUpdateChecker.findCliUpdate(engine),
    ]);
    if (modelsOrProblem.models === null) {
      // Not cached: the next form opening tries again (e.g. after `codex login`).
      const fallback =
        this.lastReadModels.get(engine) ??
        (engine === 'claude_code' ? [...CLAUDE_CODE_MODEL_CHOICES] : []);
      return { models: fallback, problem: modelsOrProblem.problem, cliUpdate };
    }
    this.lastReadModels.set(engine, modelsOrProblem.models);
    const list = { models: modelsOrProblem.models, problem: null, cliUpdate };
    this.cachedLists.set(engine, { expiresAt: Date.now() + ENGINE_CATALOG_CACHE_MS, list });
    return list;
  }

  private readCatalogModels(engine: LocalEngine): Promise<LocalEngineModelChoice[]> {
    if (engine === 'claude_code') return this.claudeModelCatalog.listClaudeModels();
    if (engine === 'codex') return this.codexModelCatalog.listCodexModels();
    return this.antigravityModelCatalog.listAntigravityModels();
  }
}
