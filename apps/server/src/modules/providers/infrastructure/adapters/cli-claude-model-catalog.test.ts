import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors/app-error';
import {
  CLAUDE_INITIALIZE_REQUEST_LINE,
  parseClaudeInitializeLine,
} from './cli-claude-model-catalog';

function readFixtureLines(fixtureName: string): string[] {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', fixtureName), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

function initializeAnswer(models: unknown[], subtype = 'success'): string {
  return JSON.stringify({
    type: 'control_response',
    response: { subtype, request_id: 'aiteam-models', response: { models } },
  });
}

describe('parseClaudeInitializeLine', () => {
  it('sends the initialize request the recording answers', () => {
    expect(JSON.parse(CLAUDE_INITIALIZE_REQUEST_LINE)).toEqual({
      type: 'control_request',
      request_id: 'aiteam-models',
      request: { subtype: 'initialize' },
    });
  });

  it('lists aliases with their real model first, then pinned versions (real recording)', () => {
    const lists = readFixtureLines('claude-initialize.jsonl')
      .map(parseClaudeInitializeLine)
      .filter((list) => list !== null);
    expect(lists).toHaveLength(1);
    const choices = lists[0] ?? [];
    expect(choices.map((choice) => choice.model)).toEqual([
      'opus',
      'sonnet',
      'fable',
      'haiku',
      'claude-fable-5-1',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ]);
    expect(choices[2]).toEqual({
      model: 'fable',
      label: 'Fable 5.2',
      note: 'fable · luôn là bản mới nhất · For your toughest challenges',
    });
    expect(choices[4]).toEqual({
      model: 'claude-fable-5-1',
      label: 'Fable 5.1',
      note: 'Most capable for your hardest and longest-running tasks',
    });
  });

  it('ignores other lines, including control responses to other requests', () => {
    expect(parseClaudeInitializeLine('not json')).toBeNull();
    expect(
      parseClaudeInitializeLine(JSON.stringify({ type: 'system', subtype: 'init' })),
    ).toBeNull();
    expect(
      parseClaudeInitializeLine(
        JSON.stringify({
          type: 'control_response',
          response: { subtype: 'success', request_id: 'other', response: { models: [] } },
        }),
      ),
    ).toBeNull();
  });

  it('drops the default entry, unsafe names and malformed entries; clips long text', () => {
    const choices = parseClaudeInitializeLine(
      initializeAnswer([
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default' },
        { value: '--dangerously-skip-permissions', resolvedModel: null },
        { value: 42 },
        { value: 'claude-next', displayName: null, description: 'd'.repeat(500) },
      ]),
    );
    expect(choices).toHaveLength(1);
    expect(choices?.[0]?.label).toBe('claude-next');
    expect(choices?.[0]?.note).toHaveLength(160);
  });

  it('reports an error answer as an unreadable list', () => {
    let caught: unknown;
    try {
      parseClaudeInitializeLine(initializeAnswer([], 'error'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('CLAUDE_MODEL_CATALOG_FAILED');
  });
});
