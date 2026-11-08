import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { type LocalEngineModelChoice, modelNameSchema } from '@aiteam/contracts';
import { z } from 'zod';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { CodexModelCatalog } from '../../application/ports/codex-model-catalog.port';
import { resolveCliExecutable } from './engines/cli-process';

const runExecutable = promisify(execFile);
const CATALOG_TIMEOUT_MS = 20_000;
/** The raw catalog carries every model's base instructions: ~450 KB today. */
const CATALOG_MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHOICES = 30;
const LABEL_MAX_LENGTH = 60;
const NOTE_MAX_LENGTH = 160;

/**
 * Only the fields we use; everything else in the catalog is ignored. `codex debug models` is a
 * debugging command, so a format change must degrade to "type the model name", never crash.
 */
const codexCatalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string().nullish(),
      description: z.string().nullish(),
      visibility: z.string().nullish(),
      priority: z.number().nullish(),
    }),
  ),
});

/** Reads `codex debug models` (the catalog Codex refreshes from OpenAI), without a shell. */
@Injectable()
export class CliCodexModelCatalog implements CodexModelCatalog {
  async listCodexModels(): Promise<LocalEngineModelChoice[]> {
    const executable = resolveCliExecutable('codex');
    let stdout: string;
    try {
      ({ stdout } = await runExecutable(
        executable.command,
        [...executable.leadingArgs, 'debug', 'models'],
        {
          timeout: CATALOG_TIMEOUT_MS,
          maxBuffer: CATALOG_MAX_BYTES,
          windowsHide: true,
          encoding: 'utf8',
        },
      ));
    } catch (error) {
      throw new EngineUnavailableError(
        'Không đọc được danh sách model của Codex (codex debug models). Vẫn tự nhập tên được.',
        { code: 'CODEX_MODEL_CATALOG_FAILED', cause: error },
      );
    }
    return parseCodexModelCatalog(stdout);
  }
}

/** Models Codex itself lists in its picker (visibility "list"), in Codex's own order. */
export function parseCodexModelCatalog(rawCatalog: string): LocalEngineModelChoice[] {
  let catalog;
  try {
    catalog = codexCatalogSchema.parse(JSON.parse(rawCatalog));
  } catch (error) {
    throw new EngineUnavailableError(
      'Danh sách model của Codex có định dạng lạ (bản Codex mới?). Vẫn tự nhập tên được.',
      { code: 'CODEX_MODEL_CATALOG_UNREADABLE', cause: error },
    );
  }
  return catalog.models
    .filter((entry) => entry.visibility === 'list' && modelNameSchema.safeParse(entry.slug).success)
    .sort(
      (first, second) =>
        (first.priority ?? Number.MAX_SAFE_INTEGER) - (second.priority ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, MAX_CHOICES)
    .map((entry) => ({
      model: entry.slug,
      label: clip(entry.display_name?.trim() || entry.slug, LABEL_MAX_LENGTH),
      note: clip(entry.description?.trim() ?? '', NOTE_MAX_LENGTH),
    }));
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
