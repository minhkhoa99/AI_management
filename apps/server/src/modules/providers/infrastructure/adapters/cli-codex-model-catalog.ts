import { Injectable } from '@nestjs/common';
import { type LocalEngineModelChoice, modelNameSchema } from '@aiteam/contracts';
import { z } from 'zod';
import { AppError, EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { CodexModelCatalog } from '../../application/ports/codex-model-catalog.port';
import {
  type ResolvedExecutable,
  resolveCliExecutable,
  streamCliOutput,
} from './engines/cli-process';
import { prepareQuotaProbeDirectory } from './quota/quota-probe-directory';
import { clipCatalogText, MAX_MODEL_CHOICES } from './model-choice-text';

const CATALOG_TIMEOUT_MS = 20_000;
const MODEL_LIST_REQUEST_ID = 2;
/** One page holds every model Codex offers (8 today); later pages are not requested. */
const MODEL_LIST_PAGE_SIZE = 100;

export const CODEX_MODEL_LIST_REQUEST_LINES: readonly string[] = [
  JSON.stringify({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'aiteam', version: '1' } },
  }),
  JSON.stringify({ method: 'initialized' }),
  JSON.stringify({
    id: MODEL_LIST_REQUEST_ID,
    method: 'model/list',
    params: { includeHidden: false, limit: MODEL_LIST_PAGE_SIZE },
  }),
];

const codexModelSchema = z.object({
  id: z.string(),
  model: z.string().nullish(),
  displayName: z.string().nullish(),
  description: z.string().nullish(),
  hidden: z.boolean().nullish(),
  isDefault: z.boolean().nullish(),
});

/** Only the fields we use; everything else in the answer is ignored. */
const modelListLineSchema = z.object({
  id: z.literal(MODEL_LIST_REQUEST_ID),
  error: z.object({ message: z.string().optional() }).optional(),
  // eslint-disable-next-line id-denylist -- field name of the Codex app-server protocol
  result: z.object({ data: z.array(z.unknown()) }).optional(),
});

/**
 * Asks `codex app-server` (JSON-RPC over stdio) for the models the installed Codex offers — the
 * list OpenAI serves for that CLI version — without a shell, in the quota probe folder.
 */
@Injectable()
export class CliCodexModelCatalog implements CodexModelCatalog {
  constructor(
    private readonly dataDirectory: string,
    private readonly timeoutMilliseconds: number = CATALOG_TIMEOUT_MS,
    /** Tests run a fake CLI instead. */
    private readonly resolveExecutable: () => ResolvedExecutable = () =>
      resolveCliExecutable('codex'),
  ) {}

  async listCodexModels(): Promise<LocalEngineModelChoice[]> {
    try {
      const executable = this.resolveExecutable();
      const probeDirectory = await prepareQuotaProbeDirectory(this.dataDirectory);
      const output = streamCliOutput(
        {
          executable,
          args: ['app-server'],
          workingDirectory: probeDirectory,
          stdinText: `${CODEX_MODEL_LIST_REQUEST_LINES.join('\n')}\n`,
          // The server quits on EOF before answering; leaving the loop kills it.
          keepStdinOpen: true,
        },
        AbortSignal.timeout(this.timeoutMilliseconds),
      );
      for await (const item of output) {
        if (item.kind !== 'line') break;
        const models = parseCodexModelListLine(item.text);
        if (models !== null) return models;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw catalogUnreadable(error);
    }
    throw catalogUnreadable(undefined);
  }
}

/** The model choices from the answer to `model/list`; null for any other line. */
export function parseCodexModelListLine(line: string): LocalEngineModelChoice[] | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    // Not JSON: not the answer being waited for.
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  if ((json as { id?: unknown }).id !== MODEL_LIST_REQUEST_ID) return null;
  const parsed = modelListLineSchema.safeParse(json);
  if (!parsed.success || parsed.data.result === undefined) {
    throw catalogUnreadable(parsed.success ? parsed.data.error?.message : parsed.error);
  }
  const choices: LocalEngineModelChoice[] = [];
  for (const rawModel of parsed.data.result.data) {
    const entry = codexModelSchema.safeParse(rawModel);
    if (!entry.success || entry.data.hidden === true) continue;
    const model = entry.data.model ?? entry.data.id;
    if (!modelNameSchema.safeParse(model).success) continue;
    const description = entry.data.description?.trim() ?? '';
    const note =
      entry.data.isDefault === true ? `mặc định của Codex · ${description}` : description;
    choices.push({
      model,
      label: clipCatalogText(entry.data.displayName?.trim() || model, 'label'),
      note: clipCatalogText(note.replace(/ · $/, ''), 'note'),
    });
  }
  return choices.slice(0, MAX_MODEL_CHOICES);
}

function catalogUnreadable(cause: unknown): EngineUnavailableError {
  return new EngineUnavailableError(
    'Không đọc được danh sách model của Codex (codex app-server). Vẫn tự nhập tên được.',
    { code: 'CODEX_MODEL_CATALOG_FAILED', cause },
  );
}
