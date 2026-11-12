import { type LocalEngineModelChoice, modelNameSchema } from '@aiteam/contracts';
import { z } from 'zod';
import { AppError, EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { ClaudeModelCatalog } from '../../application/ports/claude-model-catalog.port';
import { FLAG_SETTINGS } from './engines/claude-code-cli.engine';
import {
  type ResolvedExecutable,
  resolveCliExecutable,
  streamCliOutput,
} from './engines/cli-process';
import { prepareQuotaProbeDirectory } from './quota/quota-probe-directory';
import { clipCatalogText, MAX_MODEL_CHOICES } from './model-choice-text';

const CATALOG_TIMEOUT_MS = 20_000;
const INITIALIZE_REQUEST_ID = 'aiteam-models';
/** Already offered by the form as "the engine's default model". */
const DEFAULT_OPTION_VALUE = 'default';

/**
 * The SDK handshake: Claude Code answers with its model options (the `/model` list) without
 * starting a turn, so reading it costs no tokens.
 */
export const CLAUDE_INITIALIZE_REQUEST_LINE = JSON.stringify({
  type: 'control_request',
  request_id: INITIALIZE_REQUEST_ID,
  request: { subtype: 'initialize' },
});

const modelOptionSchema = z.object({
  value: z.string(),
  resolvedModel: z.string().nullish(),
  displayName: z.string().nullish(),
  description: z.string().nullish(),
});

/** Only the fields we use; everything else (account details among them) is never read. */
const initializeResponseSchema = z.object({
  type: z.literal('control_response'),
  response: z.object({
    subtype: z.string(),
    request_id: z.literal(INITIALIZE_REQUEST_ID),
    error: z.string().nullish(),
    response: z.object({ models: z.array(z.unknown()) }).nullish(),
  }),
});

/**
 * Asks the installed Claude Code for its model list over the stream-json control protocol,
 * without a shell, with no settings file, hook or MCP server loaded, in the quota probe folder.
 */
export class CliClaudeModelCatalog implements ClaudeModelCatalog {
  constructor(
    private readonly dataDirectory: string,
    private readonly timeoutMilliseconds: number = CATALOG_TIMEOUT_MS,
    /** Tests run a fake CLI instead. */
    private readonly resolveExecutable: () => ResolvedExecutable = () =>
      resolveCliExecutable('claude'),
  ) {}

  async listClaudeModels(): Promise<LocalEngineModelChoice[]> {
    try {
      const executable = this.resolveExecutable();
      const probeDirectory = await prepareQuotaProbeDirectory(this.dataDirectory);
      const output = streamCliOutput(
        {
          executable,
          args: [
            '-p',
            '--input-format',
            'stream-json',
            '--output-format',
            'stream-json',
            '--verbose',
            '--setting-sources',
            '',
            '--settings',
            FLAG_SETTINGS,
            '--strict-mcp-config',
          ],
          workingDirectory: probeDirectory,
          stdinText: `${CLAUDE_INITIALIZE_REQUEST_LINE}\n`,
          keepStdinOpen: true,
        },
        AbortSignal.timeout(this.timeoutMilliseconds),
      );
      // Leaving the loop stops the CLI (and its whole process tree).
      for await (const item of output) {
        if (item.kind !== 'line') break;
        const models = parseClaudeInitializeLine(item.text);
        if (models !== null) return models;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw catalogUnreadable(error);
    }
    throw catalogUnreadable(undefined);
  }
}

/** The model choices from the answer to our initialize request; null for any other line. */
export function parseClaudeInitializeLine(line: string): LocalEngineModelChoice[] | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    // Not JSON (a warning line): not the answer being waited for.
    return null;
  }
  const parsed = initializeResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const answer = parsed.data.response;
  if (answer.subtype !== 'success' || !answer.response) {
    throw catalogUnreadable(answer.error ?? answer.subtype);
  }
  return toModelChoices(answer.response.models);
}

/**
 * Aliases first (`fable` → "Fable 5.2", always the newest of the family), then pinned versions,
 * each in Claude Code's own order. Entries that are not safe model names are dropped.
 */
function toModelChoices(rawOptions: readonly unknown[]): LocalEngineModelChoice[] {
  const aliases: LocalEngineModelChoice[] = [];
  const pinned: LocalEngineModelChoice[] = [];
  for (const rawOption of rawOptions) {
    const option = modelOptionSchema.safeParse(rawOption);
    if (!option.success) continue;
    const { value, resolvedModel, displayName, description } = option.data;
    if (value === DEFAULT_OPTION_VALUE || !modelNameSchema.safeParse(value).success) continue;
    const label = clipCatalogText(displayName?.trim() || value, 'label');
    const detail = description?.trim() ?? '';
    const isAlias =
      resolvedModel !== null && resolvedModel !== undefined && resolvedModel !== value;
    if (isAlias) {
      const note = [value, 'luôn là bản mới nhất', detail].filter(Boolean).join(' · ');
      aliases.push({ model: value, label, note: clipCatalogText(note, 'note') });
    } else {
      pinned.push({ model: value, label, note: clipCatalogText(detail, 'note') });
    }
  }
  return [...aliases, ...pinned].slice(0, MAX_MODEL_CHOICES);
}

function catalogUnreadable(cause: unknown): EngineUnavailableError {
  return new EngineUnavailableError(
    'Không đọc được danh sách model từ Claude Code; đang hiện các tên ngắn. Vẫn tự nhập tên được.',
    { code: 'CLAUDE_MODEL_CATALOG_FAILED', cause },
  );
}
