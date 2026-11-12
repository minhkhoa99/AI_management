import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors/app-error';
import { CliClaudeModelCatalog } from './cli-claude-model-catalog';
import { CliCodexModelCatalog } from './cli-codex-model-catalog';

/** A fake CLI: Node running `script` (`--` keeps the CLI's own flags away from Node). */
const fakeCli = (script: string) => () => ({
  command: process.execPath,
  leadingArgs: ['-e', script, '--'],
});

const ANSWER_THEN_LINGER = (answerLine: string, requestMatch: string) =>
  [
    "const rl = require('node:readline').createInterface({ input: process.stdin });",
    `rl.on('line', (line) => { if (line.includes(${JSON.stringify(requestMatch)})) console.log(${JSON.stringify(answerLine)}); });`,
    'setInterval(() => undefined, 1000);',
  ].join(' ');
const EXIT_AT_ONCE = 'console.log("not json"); process.exit(0);';
const NEVER_ANSWER = 'process.stdin.resume(); setInterval(() => undefined, 1000);';

const CODEX_ANSWER = JSON.stringify({
  id: 2,
  // eslint-disable-next-line id-denylist -- field name of the Codex app-server protocol
  result: { data: [{ id: 'gpt-7', displayName: 'GPT-7' }], nextCursor: null },
});
const CLAUDE_ANSWER = JSON.stringify({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'aiteam-models',
    response: { models: [{ value: 'claude-x-1', displayName: 'X 1' }] },
  },
});

let dataDirectory: string;
beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-catalog-'));
});
afterEach(() => {
  // The killed fake CLI may still hold its working folder for a moment on Windows.
  rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const catalogs = [
  {
    name: 'Codex',
    code: 'CODEX_MODEL_CATALOG_FAILED',
    answer: ANSWER_THEN_LINGER(CODEX_ANSWER, 'model/list'),
    expectedModel: 'gpt-7',
    read: (script: string, timeoutMs = 20_000) =>
      new CliCodexModelCatalog(dataDirectory, timeoutMs, fakeCli(script)).listCodexModels(),
  },
  {
    name: 'Claude Code',
    code: 'CLAUDE_MODEL_CATALOG_FAILED',
    answer: ANSWER_THEN_LINGER(CLAUDE_ANSWER, 'initialize'),
    expectedModel: 'claude-x-1',
    read: (script: string, timeoutMs = 20_000) =>
      new CliClaudeModelCatalog(dataDirectory, timeoutMs, fakeCli(script)).listClaudeModels(),
  },
];

async function readFailureCode(pending: Promise<unknown>): Promise<string | null> {
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : 'not an AppError';
  }
}

describe.each(catalogs)('$name model catalog process', (catalog) => {
  it('returns as soon as the CLI answers, without waiting for it to exit', async () => {
    const startedAt = Date.now();
    const models = await catalog.read(catalog.answer);
    expect(models.map((choice) => choice.model)).toEqual([catalog.expectedModel]);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it('reports a CLI that exits without answering', async () => {
    expect(await readFailureCode(catalog.read(EXIT_AT_ONCE))).toBe(catalog.code);
  });

  it('stops a CLI that never answers at the timeout', async () => {
    const startedAt = Date.now();
    expect(await readFailureCode(catalog.read(NEVER_ANSWER, 500))).toBe(catalog.code);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });
});
