import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliUpdateNotice, LocalEngineModelChoice } from '@aiteam/contracts';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import { CLAUDE_CODE_MODEL_CHOICES } from '../../domain/claude-code-models';
import {
  ENGINE_CATALOG_CACHE_MS,
  ListLocalEngineModelsUseCase,
} from './list-local-engine-models.use-case';

const LUNA: LocalEngineModelChoice = { model: 'gpt-5.6-luna', label: 'Luna', note: 'Fast.' };
const SOL: LocalEngineModelChoice = { model: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', note: 'New.' };
const FABLE: LocalEngineModelChoice = { model: 'fable', label: 'Fable 5.2', note: 'fable' };
const AGY_FLASH: LocalEngineModelChoice = { model: 'agy-flash', label: 'Flash', note: 'Fast.' };
const CODEX_UPDATE: CliUpdateNotice = {
  installedVersion: '0.155.1',
  latestVersion: '0.167.2',
  updateCommand: 'npm i -g @openai/codex@latest',
};

const unreadable = (message: string) => Promise.reject(new EngineUnavailableError(message));

function buildUseCase(
  overrides: {
    claude?: () => Promise<LocalEngineModelChoice[]>;
    codex?: () => Promise<LocalEngineModelChoice[]>;
    antigravity?: () => Promise<LocalEngineModelChoice[]>;
    cliUpdate?: () => Promise<CliUpdateNotice | null>;
  } = {},
) {
  const claudeCatalog = {
    listClaudeModels: vi.fn(overrides.claude ?? (() => Promise.resolve([FABLE]))),
  };
  const codexCatalog = {
    listCodexModels: vi.fn(overrides.codex ?? (() => Promise.resolve([LUNA]))),
  };
  const antigravityCatalog = {
    listAntigravityModels: vi.fn(overrides.antigravity ?? (() => Promise.resolve([AGY_FLASH]))),
  };
  const updateChecker = {
    findCliUpdate: vi.fn(overrides.cliUpdate ?? (() => Promise.resolve(null))),
  };
  return {
    claudeCatalog,
    codexCatalog,
    antigravityCatalog,
    updateChecker,
    useCase: new ListLocalEngineModelsUseCase(
      claudeCatalog,
      codexCatalog,
      antigravityCatalog,
      updateChecker,
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ListLocalEngineModelsUseCase', () => {
  it('reads each engine from its own CLI list, with the CLI update notice', async () => {
    const { useCase, updateChecker } = buildUseCase({
      cliUpdate: () => Promise.resolve(CODEX_UPDATE),
    });
    expect(await useCase.listLocalEngineModels('claude_code')).toEqual({
      models: [FABLE],
      problem: null,
      cliUpdate: CODEX_UPDATE,
    });
    expect(await useCase.listLocalEngineModels('codex')).toMatchObject({ models: [LUNA] });
    expect(await useCase.listLocalEngineModels('antigravity')).toEqual({
      models: [AGY_FLASH],
      problem: null,
      cliUpdate: null,
    });
    // Antigravity is not published on npm: never checked.
    expect(updateChecker.findCliUpdate.mock.calls).toEqual([['claude_code'], ['codex']]);
  });

  it('reads a list once per cache window; refresh re-reads at once', async () => {
    vi.useFakeTimers();
    const { codexCatalog, useCase } = buildUseCase();
    await useCase.listLocalEngineModels('codex');
    await useCase.listLocalEngineModels('codex');
    expect(codexCatalog.listCodexModels).toHaveBeenCalledTimes(1);

    codexCatalog.listCodexModels.mockResolvedValueOnce([SOL, LUNA]);
    expect(
      (await useCase.listLocalEngineModels('codex', { refresh: true })).models.map(
        (choice) => choice.model,
      ),
    ).toEqual(['gpt-6.1-sol', 'gpt-5.6-luna']);
    expect(codexCatalog.listCodexModels).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(ENGINE_CATALOG_CACHE_MS + 1);
    await useCase.listLocalEngineModels('codex');
    expect(codexCatalog.listCodexModels).toHaveBeenCalledTimes(3);
  });

  it('shares one read between callers while it runs, refresh included', async () => {
    let finishRead: (models: LocalEngineModelChoice[]) => void = () => undefined;
    const { codexCatalog, useCase } = buildUseCase({
      codex: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    });
    const first = useCase.listLocalEngineModels('codex');
    const second = useCase.listLocalEngineModels('codex', { refresh: true });
    finishRead([SOL]);
    expect(await first).toEqual(await second);
    expect(codexCatalog.listCodexModels).toHaveBeenCalledTimes(1);
  });

  it('keeps the last list read when a later read fails, and reads again on refresh', async () => {
    const { codexCatalog, useCase } = buildUseCase();
    await useCase.listLocalEngineModels('codex');
    codexCatalog.listCodexModels.mockImplementationOnce(() => unreadable('Codex hỏng'));
    expect(await useCase.listLocalEngineModels('codex', { refresh: true })).toEqual({
      models: [LUNA],
      problem: 'Codex hỏng',
      cliUpdate: null,
    });
    codexCatalog.listCodexModels.mockResolvedValueOnce([SOL]);
    expect((await useCase.listLocalEngineModels('codex', { refresh: true })).models).toEqual([SOL]);
  });

  it('falls back to the built-in aliases for Claude and to nothing for Codex', async () => {
    const { useCase } = buildUseCase({
      claude: () => unreadable('Claude hỏng'),
      codex: () => unreadable('Codex hỏng'),
    });
    expect(await useCase.listLocalEngineModels('claude_code')).toEqual({
      models: [...CLAUDE_CODE_MODEL_CHOICES],
      problem: 'Claude hỏng',
      cliUpdate: null,
    });
    expect(await useCase.listLocalEngineModels('codex')).toEqual({
      models: [],
      problem: 'Codex hỏng',
      cliUpdate: null,
    });
  });

  it('lets unexpected errors through', async () => {
    const { useCase } = buildUseCase({ codex: () => Promise.reject(new TypeError('bug')) });
    await expect(useCase.listLocalEngineModels('codex')).rejects.toThrow(TypeError);
  });
});
