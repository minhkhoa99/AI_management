import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type {
  DirectoryFacts,
  DirectoryInspector,
} from '../../application/ports/local-directories.port';

const MISSING_PATH_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP']);
/** Windows and (by default) macOS file systems ignore case. */
const CASE_INSENSITIVE_FILE_SYSTEM = process.platform === 'win32' || process.platform === 'darwin';

@Injectable()
export class FsDirectoryInspector implements DirectoryInspector {
  async inspectDirectory(rawPath: string): Promise<DirectoryFacts> {
    const expanded = rawPath.trim().replace(/^~(?=$|[\\/])/, homedir());
    const absolutePath = path.resolve(expanded);
    try {
      const resolvedPath = await realpath(absolutePath);
      const isDirectory = (await stat(resolvedPath)).isDirectory();
      return {
        absolutePath: resolvedPath,
        exists: true,
        isDirectory,
        isGitRepository: isDirectory && (await isInsideGitWorkTree(resolvedPath)),
      };
    } catch (error) {
      if (isMissingPathError(error)) {
        return { absolutePath, exists: false, isDirectory: false, isGitRepository: false };
      }
      throw error;
    }
  }

  isInsideDirectory(candidatePath: string, parentPath: string): boolean {
    const relative = path.relative(
      normaliseForComparison(parentPath),
      normaliseForComparison(candidatePath),
    );
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  }
}

function normaliseForComparison(directoryPath: string): string {
  const resolved = path.resolve(directoryPath);
  return CASE_INSENSITIVE_FILE_SYSTEM ? resolved.toLowerCase() : resolved;
}

/** A ".git" folder or file (worktrees, submodules) in the folder or one of its parents. */
async function isInsideGitWorkTree(directoryPath: string): Promise<boolean> {
  let current = directoryPath;
  for (;;) {
    try {
      await stat(path.join(current, '.git'));
      return true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && MISSING_PATH_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  );
}
