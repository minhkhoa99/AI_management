import { describe, expect, it } from 'vitest';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import { parseAntigravityModelList } from './cli-antigravity-model-catalog';

const REAL_OUTPUT =
  'Fetching available models...\r\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\r\n';

describe('parseAntigravityModelList', () => {
  it('reads slug and label of each tab-separated line, in the CLI order', () =>
    expect(parseAntigravityModelList(REAL_OUTPUT)).toEqual([
      { model: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', note: '' },
      { model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', note: '' },
    ]));

  it('skips noise, blank lines and unsafe model names', () =>
    expect(parseAntigravityModelList('warning: x\n\n-rf\tBad\nok-model\tOK\n')).toEqual([
      { model: 'ok-model', label: 'OK', note: '' },
    ]));

  it('uses the slug as label when the label is empty, and ignores lines without a tab', () =>
    expect(parseAntigravityModelList('other-model\nsolo-model\t\nreal-model\tReal\n')).toEqual([
      { model: 'solo-model', label: 'solo-model', note: '' },
      { model: 'real-model', label: 'Real', note: '' },
    ]));

  it('throws ANTIGRAVITY_MODEL_CATALOG_UNREADABLE when no line is a model', () => {
    const attempt = () => parseAntigravityModelList('Fetching available models...\n');
    expect(attempt).toThrow(EngineUnavailableError);
    expect(attempt).toThrow(
      expect.objectContaining({ code: 'ANTIGRAVITY_MODEL_CATALOG_UNREADABLE' }),
    );
  });

  it('keeps at most 30 models', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `model-${index}\tModel ${index}`);
    const choices = parseAntigravityModelList(lines.join('\n'));
    expect(choices).toHaveLength(30);
    expect(choices[29]?.model).toBe('model-29');
  });

  it('clips labels longer than 60 characters with an ellipsis', () => {
    const [choice] = parseAntigravityModelList(`long-model\t${'a'.repeat(80)}\n`);
    expect(choice?.label).toBe(`${'a'.repeat(59)}…`);
    expect(choice?.label).toHaveLength(60);
  });
});
