import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors/app-error';
import { parseCodexModelCatalog } from './cli-codex-model-catalog';

const catalog = (models: unknown[]) => JSON.stringify({ models });

describe('parseCodexModelCatalog', () => {
  it('keeps the models Codex lists, in its priority order, with label and note', () => {
    const choices = parseCodexModelCatalog(
      catalog([
        {
          slug: 'gpt-5.6-luna',
          display_name: 'GPT-5.6-Luna',
          description: 'Fast.',
          visibility: 'list',
          priority: 8,
          base_instructions: 'x'.repeat(1000),
        },
        {
          slug: 'gpt-6-astra',
          display_name: 'GPT-6-Astra',
          description: 'Most capable.',
          visibility: 'list',
          priority: 1,
        },
        { slug: 'codex-auto-review', display_name: 'Auto Review', visibility: 'hide', priority: 2 },
      ]),
    );
    expect(choices).toEqual([
      { model: 'gpt-6-astra', label: 'GPT-6-Astra', note: 'Most capable.' },
      { model: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', note: 'Fast.' },
    ]);
  });

  it('drops slugs that are not safe model names (CLI flag injection) and clips long text', () => {
    const choices = parseCodexModelCatalog(
      catalog([
        { slug: '--dangerously-bypass', visibility: 'list' },
        { slug: 'gpt x', visibility: 'list' },
        { slug: 'gpt-7', display_name: null, description: 'd'.repeat(500), visibility: 'list' },
      ]),
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]?.label).toBe('gpt-7');
    expect(choices[0]?.note.length).toBe(160);
    expect(choices[0]?.note.endsWith('…')).toBe(true);
  });

  it('turns an unknown format into an AppError instead of crashing', () => {
    expect(() => parseCodexModelCatalog('not json')).toThrow(AppError);
    expect(() => parseCodexModelCatalog(JSON.stringify({ items: [] }))).toThrow(AppError);
  });
});
