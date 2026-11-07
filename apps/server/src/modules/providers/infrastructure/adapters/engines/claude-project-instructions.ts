import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const INSTRUCTIONS_FILE_NAME = 'CLAUDE.md';
const FILE_MAX_CHARACTERS = 16_000;
const TOTAL_MAX_CHARACTERS = 24_000;

/**
 * The CLAUDE.md files Claude Code would load for `workingDirectory`: from the repository root (the
 * nearest folder holding `.git`) down to the working directory. aiteam runs Claude with
 * `--setting-sources ""` because `.claude/` in a worktree is written by agents (hooks and
 * apiKeyHelper there would run commands); that also stops Claude from reading CLAUDE.md, so the
 * platform passes the project's instructions in the prompt instead.
 *
 * Only regular files count (a symlink planted by an agent could point anywhere). Each file and
 * the total are capped. Returns null when there is none.
 */
export function readClaudeProjectInstructions(workingDirectory: string): string | null {
  const folders = listFoldersFromRepositoryRoot(path.resolve(workingDirectory));
  const repositoryRoot = folders[0] ?? workingDirectory;
  const sections: string[] = [];
  let remaining = TOTAL_MAX_CHARACTERS;
  for (const folder of folders) {
    const filePath = path.join(folder, INSTRUCTIONS_FILE_NAME);
    const content = readRegularTextFile(filePath);
    if (content === null || content.trim() === '' || remaining <= 0) continue;
    const clipped = content.slice(0, Math.min(FILE_MAX_CHARACTERS, remaining));
    remaining -= clipped.length;
    const label = path.relative(repositoryRoot, filePath).split(path.sep).join('/');
    sections.push(`--- ${label} ---\n${clipped.trim()}`);
  }
  return sections.length === 0 ? null : sections.join('\n\n');
}

/** Folders from the repository root down to `startFolder` (just `startFolder` outside a repo). */
function listFoldersFromRepositoryRoot(startFolder: string): string[] {
  const folders: string[] = [];
  for (let folder = startFolder; ; folder = path.dirname(folder)) {
    folders.unshift(folder);
    if (existsSync(path.join(folder, '.git'))) return folders;
    if (path.dirname(folder) === folder) return [startFolder];
  }
}

function readRegularTextFile(filePath: string): string | null {
  try {
    if (!lstatSync(filePath).isFile()) return null;
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}
