import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalEngineModelChoice } from '@aiteam/contracts';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { CodexModelCatalog } from '../ports/codex-model-catalog.port';
import {
  CODEX_CATALOG_CACHE_MS,
  ListLocalEngineModelsUseCase,
} from './list-local-engine-models.use-case';

const LUNA: LocalEngineModelChoice = { model: 'gpt-5.6-luna', label: 'Luna', note: 'Fast.' };

function buildUseCase(listCodexModels: CodexModelCatalog['listCodexModels']) {
  const catalog = { listCodexModels: vi.fn(listCodexModels) };
  return { catalog, useCase: new ListLocalEngineModelsUseCase(catalog) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ListLocalEngineModelsUseCase', () => {
  it('offers the Claude Code aliases without running any CLI', async () => {
    const { catalog, useCase } = buildUseCase(() => Promise.resolve([]));
    const list = await useCase.listLocalEngineModels('claude_code');
    expect(list.problem).toBeNull();
    expect(list.models.map((choice) => choice.model)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(catalog.listCodexModels).not.toHaveBeenCalled();
  });

  it('reads the Codex catalog once per cache window', async () => {
    vi.useFakeTimers();
    const { catalog, useCase } = buildUseCase(() => Promise.resolve([LUNA]));
    expect(await useCase.listLocalEngineModels('codex')).toEqual({ models: [LUNA], problem: null });
    await useCase.listLocalEngineModels('codex');
    expect(catalog.listCodexModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(CODEX_CATALOG_CACHE_MS + 1);
    await useCase.listLocalEngineModels('codex');
    expect(catalog.listCodexModels).toHaveBeenCalledTimes(2);
  });

  it('reports a catalog failure as a problem and retries on the next call', async () => {
    const { catalog, useCase } = buildUseCase(() =>
      Promise.reject(new EngineUnavailableError('Không đọc được danh sách model của Codex')),
    );
    expect(await useCase.listLocalEngineModels('codex')).toEqual({
      models: [],
      problem: 'Không đọc được danh sách model của Codex',
    });
    catalog.listCodexModels.mockResolvedValueOnce([LUNA]);
    expect((await useCase.listLocalEngineModels('codex')).models).toEqual([LUNA]);
  });

  it('lets unexpected errors through', async () => {
    const { useCase } = buildUseCase(() => Promise.reject(new TypeError('bug')));
    await expect(useCase.listLocalEngineModels('codex')).rejects.toThrow(TypeError);
  });
});
