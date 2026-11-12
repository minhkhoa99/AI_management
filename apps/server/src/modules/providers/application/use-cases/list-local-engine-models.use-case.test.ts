import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalEngineModelChoice } from '@aiteam/contracts';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { AntigravityModelCatalog } from '../ports/antigravity-model-catalog.port';
import type { CodexModelCatalog } from '../ports/codex-model-catalog.port';
import {
  ENGINE_CATALOG_CACHE_MS,
  ListLocalEngineModelsUseCase,
} from './list-local-engine-models.use-case';

const LUNA: LocalEngineModelChoice = { model: 'gpt-5.6-luna', label: 'Luna', note: 'Fast.' };

const AGY_FLASH: LocalEngineModelChoice = { model: 'agy-flash', label: 'Flash', note: 'Fast.' };

function buildUseCase(
  listCodexModels: CodexModelCatalog['listCodexModels'],
  listAntigravityModels: AntigravityModelCatalog['listAntigravityModels'] = () =>
    Promise.resolve([]),
) {
  const catalog = { listCodexModels: vi.fn(listCodexModels) };
  const antigravityCatalog = { listAntigravityModels: vi.fn(listAntigravityModels) };
  return {
    catalog,
    antigravityCatalog,
    useCase: new ListLocalEngineModelsUseCase(catalog, antigravityCatalog),
  };
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

    vi.advanceTimersByTime(ENGINE_CATALOG_CACHE_MS + 1);
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

  it('reads the Antigravity catalog once per cache window, apart from the Codex cache', async () => {
    vi.useFakeTimers();
    const { catalog, antigravityCatalog, useCase } = buildUseCase(
      () => Promise.resolve([LUNA]),
      () => Promise.resolve([AGY_FLASH]),
    );
    expect(await useCase.listLocalEngineModels('antigravity')).toEqual({
      models: [AGY_FLASH],
      problem: null,
    });
    await useCase.listLocalEngineModels('antigravity');
    expect(antigravityCatalog.listAntigravityModels).toHaveBeenCalledTimes(1);
    expect(catalog.listCodexModels).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ENGINE_CATALOG_CACHE_MS + 1);
    await useCase.listLocalEngineModels('antigravity');
    expect(antigravityCatalog.listAntigravityModels).toHaveBeenCalledTimes(2);
  });

  it('reports an Antigravity catalog failure as a problem and retries on the next call', async () => {
    const { antigravityCatalog, useCase } = buildUseCase(
      () => Promise.resolve([]),
      () => Promise.reject(new EngineUnavailableError('Không đọc được danh sách model của agy')),
    );
    expect(await useCase.listLocalEngineModels('antigravity')).toEqual({
      models: [],
      problem: 'Không đọc được danh sách model của agy',
    });
    antigravityCatalog.listAntigravityModels.mockResolvedValueOnce([AGY_FLASH]);
    expect((await useCase.listLocalEngineModels('antigravity')).models).toEqual([AGY_FLASH]);
  });
});
