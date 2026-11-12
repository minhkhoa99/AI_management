import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { type LocalEngineModelChoice, modelNameSchema } from '@aiteam/contracts';
import { EngineUnavailableError } from '../../../../shared/errors/app-error';
import type { AntigravityModelCatalog } from '../../application/ports/antigravity-model-catalog.port';
import { resolveCliExecutable } from './engines/cli-process';

const runExecutable = promisify(execFile);
const CATALOG_TIMEOUT_MS = 20_000;
const CATALOG_MAX_BYTES = 1024 * 1024;
const MAX_CHOICES = 30;
const LABEL_MAX_LENGTH = 60;

/** Reads `agy models` (the list Antigravity offers for the signed-in account), without a shell. */
@Injectable()
export class CliAntigravityModelCatalog implements AntigravityModelCatalog {
  async listAntigravityModels(): Promise<LocalEngineModelChoice[]> {
    const executable = resolveCliExecutable('agy');
    let stdout: string;
    try {
      ({ stdout } = await runExecutable(executable.command, [...executable.leadingArgs, 'models'], {
        timeout: CATALOG_TIMEOUT_MS,
        maxBuffer: CATALOG_MAX_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      }));
    } catch (error) {
      throw new EngineUnavailableError(
        'Không đọc được danh sách model của Antigravity (agy models). Vẫn tự nhập tên được.',
        { code: 'ANTIGRAVITY_MODEL_CATALOG_FAILED', cause: error },
      );
    }
    return parseAntigravityModelList(stdout);
  }
}

/**
 * `agy models` prints a progress line, then one `slug<TAB>label` line per model. Only lines with
 * a TAB count; anything else (progress, warnings) is skipped. No model at all means a format change.
 */
export function parseAntigravityModelList(rawOutput: string): LocalEngineModelChoice[] {
  const choices: LocalEngineModelChoice[] = [];
  for (const line of rawOutput.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('\t');
    if (separatorIndex < 0) continue;
    const model = line.slice(0, separatorIndex).trim();
    if (!modelNameSchema.safeParse(model).success) continue;
    const label = line.slice(separatorIndex + 1).trim();
    choices.push({ model, label: clip(label || model, LABEL_MAX_LENGTH), note: '' });
  }
  if (choices.length === 0) {
    throw new EngineUnavailableError(
      'Danh sách model của Antigravity có định dạng lạ (bản agy mới?). Vẫn tự nhập tên được.',
      { code: 'ANTIGRAVITY_MODEL_CATALOG_UNREADABLE' },
    );
  }
  return choices.slice(0, MAX_CHOICES);
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
