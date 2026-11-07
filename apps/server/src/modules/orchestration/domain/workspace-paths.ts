import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { PermissionDeniedError, ValidationError } from '../../../shared/errors/app-error';

/**
 * Resolves a path that came from a request (or from agent output) inside a task worktree.
 * Absolute paths, "..", NUL and symlinks that lead outside the worktree are refused.
 */
export function resolveInsideWorktree(
  worktreePath: string,
  relativePath: string,
  options: { mayBeMissing?: boolean } = {},
): string {
  if (
    relativePath === '' ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath) ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    throw new ValidationError('Đường dẫn file không hợp lệ.', { code: 'WORKSPACE_PATH_INVALID' });
  }
  const root = realpathSync(worktreePath);
  const candidate = path.resolve(root, relativePath);
  assertInside(root, candidate);
  if (existsSync(candidate)) {
    assertInside(root, realpathSync(candidate));
  } else if (options.mayBeMissing !== true) {
    throw new ValidationError('Không tìm thấy file trong thư mục của task.', {
      code: 'WORKSPACE_FILE_NOT_FOUND',
    });
  }
  return candidate;
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PermissionDeniedError('Đường dẫn nằm ngoài thư mục của task.', {
      code: 'WORKSPACE_PATH_OUTSIDE',
    });
  }
}

/**
 * The worktree-relative form (forward slashes) of a path an agent reported, either absolute or
 * relative to its working directory. null when it is unusable or points outside the worktree.
 */
export function toWorktreeRelativePath(
  worktreePath: string,
  workDirectory: string,
  reportedPath: string,
): string | null {
  if (reportedPath === '' || reportedPath.includes('\0')) return null;
  const relativePath = path.relative(worktreePath, path.resolve(workDirectory, reportedPath));
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(path.sep).join('/');
}
