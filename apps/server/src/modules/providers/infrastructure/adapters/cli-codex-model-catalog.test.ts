import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors/app-error';
import { CODEX_MODEL_LIST_REQUEST_LINES, parseCodexModelListLine } from './cli-codex-model-catalog';

function readFixtureLines(fixtureName: string): string[] {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', fixtureName), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

const answer = (data: unknown[]) => JSON.stringify({ id: 2, result: { data, nextCursor: null } });

describe('parseCodexModelListLine', () => {
  it('asks for the visible models after the JSON-RPC handshake', () => {
    expect(CODEX_MODEL_LIST_REQUEST_LINES.map((line) => JSON.parse(line) as unknown)).toEqual([
      { id: 1, method: 'initialize', params: { clientInfo: { name: 'aiteam', version: '1' } } },
      { method: 'initialized' },
      { id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } },
    ]);
  });

  it('reads the models Codex offers, in its order (real recording, Codex 0.167.2)', () => {
    const lists = readFixtureLines('codex-model-list.jsonl')
      .map(parseCodexModelListLine)
      .filter((list) => list !== null);
    expect(lists).toHaveLength(1);
    const choices = lists[0] ?? [];
    expect(choices.map((choice) => choice.model)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6.1-terra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(choices[0]?.label).toBe('GPT-6.1-Sol');
    expect(choices.filter((choice) => choice.note.startsWith('mặc định của Codex'))).toHaveLength(
      1,
    );
  });

  it('ignores other lines', () => {
    expect(parseCodexModelListLine('not json')).toBeNull();
    expect(parseCodexModelListLine(JSON.stringify({ id: 1, result: {} }))).toBeNull();
    expect(parseCodexModelListLine(JSON.stringify({ method: 'account/updated' }))).toBeNull();
  });

  it('drops hidden models and unsafe names; clips long text', () => {
    const choices = parseCodexModelListLine(
      answer([
        { id: 'secret', hidden: true },
        { id: '--dangerously-bypass' },
        { id: 'gpt x' },
        { id: 'gpt-7', model: 'gpt-7', displayName: null, description: 'd'.repeat(500) },
        { id: 'gpt-7-mini', isDefault: true, description: null },
      ]),
    );
    expect(choices).toEqual([
      { model: 'gpt-7', label: 'gpt-7', note: `${'d'.repeat(159)}…` },
      { model: 'gpt-7-mini', label: 'gpt-7-mini', note: 'mặc định của Codex' },
    ]);
  });

  it('reports an error answer (e.g. signed out) as an unreadable list', () => {
    let caught: unknown;
    try {
      parseCodexModelListLine(JSON.stringify({ id: 2, error: { message: '401 Unauthorized' } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('CODEX_MODEL_CATALOG_FAILED');
  });
});
