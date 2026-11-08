import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../../../app-runtime-config';
import { ValidationError } from '../../../../shared/errors/app-error';
import type {
  SkillFileContent,
  SkillFileStore,
} from '../../application/ports/skill-file-store.port';
import { SKILL_MANIFEST_FILE } from '../../domain/skill-manifest';

/** ~/.aiteam/data/skills/<skillId>/…, written by the platform only (never by agents). */
@Injectable()
export class FsSkillFileStore implements SkillFileStore {
  private readonly rootDirectory: string;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.rootDirectory = path.join(runtimeConfig.dataDirectory, 'skills');
  }

  writeSkillFiles(skillId: string, files: readonly SkillFileContent[]): void {
    const folder = this.locateSkillFolder(skillId);
    // Written next to the final folder, then swapped in: a failure leaves the old files.
    const staging = `${folder}.incoming`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const file of files) {
      const target = resolveInside(staging, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    rmSync(folder, { recursive: true, force: true });
    renameSync(staging, folder);
  }

  readSkillManifest(skillId: string): string {
    return readFileSync(path.join(this.locateSkillFolder(skillId), SKILL_MANIFEST_FILE), 'utf8');
  }

  writeSkillManifest(skillId: string, text: string): void {
    const folder = this.locateSkillFolder(skillId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, SKILL_MANIFEST_FILE), text);
  }

  listSkillFiles(skillId: string): Array<{ path: string; size: number }> {
    const folder = this.locateSkillFolder(skillId);
    const files: Array<{ path: string; size: number }> = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory).sort()) {
        const absolute = path.join(directory, name);
        const entry = lstatSync(absolute);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) {
          files.push({
            path: path.relative(folder, absolute).split(path.sep).join('/'),
            size: entry.size,
          });
        }
      }
    };
    walk(folder);
    return files.sort((first, second) =>
      first.path === SKILL_MANIFEST_FILE ? -1 : second.path === SKILL_MANIFEST_FILE ? 1 : 0,
    );
  }

  readSkillFile(skillId: string, relativePath: string): Buffer {
    return readFileSync(resolveInside(this.locateSkillFolder(skillId), relativePath));
  }

  removeSkillFiles(skillId: string): void {
    rmSync(this.locateSkillFolder(skillId), { recursive: true, force: true });
  }

  locateSkillFolder(skillId: string): string {
    return resolveInside(this.rootDirectory, skillId);
  }
}

/** Joins a relative path under `root`, refusing anything that would land outside it. */
function resolveInside(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ValidationError(`Đường dẫn "${relativePath}" không hợp lệ.`, {
      code: 'SKILL_PATH_INVALID',
    });
  }
  return target;
}
