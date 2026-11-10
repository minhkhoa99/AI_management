import { execFile } from 'node:child_process';
import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../../../../shared/errors/app-error';
import { ENGINE_MANAGED_WORKSPACE_PATHS } from '../../../../../shared/runtime/engine-managed-paths';
import { SAFE_GIT_OPTIONS } from '../../../../../shared/runtime/safe-git-options';

const GIT_TIMEOUT_MS = 20_000;

/**
 * The engine loads hooks, MCP servers, plugins and sub-agents from these folders in the working
 * directory and in every parent up to the git root, and agents can write into the worktree.
 * Before each run they are deleted, unless the project itself commits them: then the run is
 * refused (nothing is deleted), because the project's own config would run commands too.
 */
export async function clearEngineManagedPaths(workingDirectory: string): Promise<void> {
  const startDirectory = await realpath(workingDirectory);
  const gitRoot = await findGitRoot(startDirectory);
  const directories =
    gitRoot === null ? [startDirectory] : directoriesUpTo(startDirectory, gitRoot);
  const candidates = directories.flatMap((directory) =>
    ENGINE_MANAGED_WORKSPACE_PATHS.map((name) => path.join(directory, name)),
  );

  if (gitRoot !== null) {
    const trackedFolder = await findTrackedCandidate(gitRoot, candidates);
    if (trackedFolder !== null) {
      throw new AppError({
        code: 'ENGINE_WORKSPACE_UNSUPPORTED',
        message: `Dự án đã commit cấu hình Antigravity (${trackedFolder}). Engine Antigravity chưa hỗ trợ dự án có hook/MCP/plugin Antigravity riêng.`,
        retryable: false,
      });
    }
  }

  for (const candidate of candidates) await removeCandidate(candidate);
}

/** Directories from `start` up to and including `root`; only `start` when it is not inside `root`. */
function directoriesUpTo(start: string, root: string): string[] {
  const relative = path.relative(root, start);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [start];
  const directories = [start];
  let current = start;
  while (current !== root) {
    current = path.dirname(current);
    directories.push(current);
  }
  return directories;
}

async function findGitRoot(directory: string): Promise<string | null> {
  try {
    const output = await runGit(directory, ['rev-parse', '--show-toplevel']);
    const topLevel = output.trim();
    // git prints forward slashes; realpath also settles short names and letter case.
    return topLevel === '' ? null : await realpath(path.resolve(topLevel));
  } catch (error) {
    if (error instanceof AppError && error.code === 'GIT_COMMAND_FAILED') return null;
    throw error;
  }
}

/** The first candidate folder (relative to the git root, forward slashes) with tracked files. */
async function findTrackedCandidate(
  gitRoot: string,
  candidates: readonly string[],
): Promise<string | null> {
  const relativeCandidates = candidates.map((candidate) =>
    path.relative(gitRoot, candidate).split(path.sep).join('/'),
  );
  const output = await runGit(gitRoot, [
    'ls-files',
    '-z',
    '--',
    ...relativeCandidates.map((candidate) => `:(literal)${candidate}`),
  ]);
  const trackedFiles = output.split('\0').filter((file) => file !== '');
  if (trackedFiles.length === 0) return null;
  return (
    relativeCandidates.find((candidate) =>
      trackedFiles.some((file) => file === candidate || file.startsWith(`${candidate}/`)),
    ) ??
    trackedFiles[0] ??
    null
  );
}

/** A link is removed itself and never followed; a regular folder or file goes entirely. */
async function removeCandidate(candidate: string): Promise<void> {
  let entry;
  try {
    entry = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(candidate, { recursive: !entry.isSymbolicLink(), force: true });
}

function runGit(directory: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...SAFE_GIT_OPTIONS, '-C', directory, ...args],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const missingGit = (error as NodeJS.ErrnoException).code === 'ENOENT';
        reject(
          new AppError({
            code: missingGit ? 'GIT_UNAVAILABLE' : 'GIT_COMMAND_FAILED',
            message: missingGit
              ? 'Không tìm thấy git trên máy. Cài git rồi chạy lại (aimanagement doctor).'
              : `git ${args[0] ?? ''} thất bại: ${stderr.trim().split('\n').at(-1) ?? ''}`,
            retryable: false,
            cause: error,
          }),
        );
      },
    );
  });
}
