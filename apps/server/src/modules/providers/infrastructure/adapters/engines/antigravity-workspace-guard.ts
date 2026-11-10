import { execFile } from 'node:child_process';
import { realpath, type Stats } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../../../../../shared/errors/app-error';
import { ENGINE_MANAGED_WORKSPACE_PATHS } from '../../../../../shared/runtime/engine-managed-paths';
import {
  buildGitEnvironmentWithoutPathspecOverrides,
  SAFE_GIT_OPTIONS,
} from '../../../../../shared/runtime/safe-git-options';

const GIT_TIMEOUT_MS = 20_000;

const REFUSAL_CODE = 'ENGINE_WORKSPACE_UNSUPPORTED';
const nativeRealpath = promisify(realpath.native);

/**
 * The engine loads hooks, MCP servers, plugins and sub-agents from these folders in the working
 * directory and in every parent up to the task worktree root, and agents can write into the
 * worktree. Before each run they are deleted, unless the project itself commits them: then the run
 * is refused (nothing is deleted), because the project's own config would run commands too.
 * `workspaceRoot` is supplied by the caller (never asked of git, whose answer an agent can move by
 * planting a `.git`); null means a throw-away directory where only the working directory counts.
 */
export async function clearEngineManagedPaths(
  workingDirectory: string,
  workspaceRoot: string | null,
): Promise<void> {
  const startDirectory = await resolveExistingDirectory(workingDirectory);
  if (workspaceRoot === null) {
    await removeCandidates(candidatePaths([startDirectory]));
    return;
  }
  const rootDirectory = await resolveExistingDirectory(workspaceRoot);
  const directories = directoriesUpTo(startDirectory, rootDirectory);
  const candidates = candidatePaths(directories);

  const trackedFolder = await findTrackedCandidate(rootDirectory, candidates);
  if (trackedFolder !== null) {
    throw new AppError({
      code: REFUSAL_CODE,
      message: `Dự án đã commit cấu hình Antigravity (${trackedFolder}). Engine Antigravity chưa hỗ trợ dự án có hook/MCP/plugin Antigravity riêng.`,
      retryable: false,
    });
  }
  await removeCandidates(candidates);
}

function candidatePaths(directories: readonly string[]): string[] {
  return directories.flatMap((directory) =>
    ENGINE_MANAGED_WORKSPACE_PATHS.map((name) => path.join(directory, name)),
  );
}

async function resolveExistingDirectory(directory: string): Promise<string> {
  try {
    return await nativeRealpath(directory);
  } catch (error) {
    throw new AppError({
      code: REFUSAL_CODE,
      message: 'Thư mục làm việc hoặc thư mục của task không tồn tại.',
      retryable: false,
      cause: error,
    });
  }
}

/** Directories from `start` up to and including `root`, by path ancestry only. */
function directoriesUpTo(start: string, root: string): string[] {
  const relative = path.relative(root, start);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AppError({
      code: REFUSAL_CODE,
      message: 'Thư mục làm việc nằm ngoài thư mục của task.',
      retryable: false,
    });
  }
  const directories = [start];
  let current = start;
  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AppError({
        code: REFUSAL_CODE,
        message: 'Thư mục làm việc nằm ngoài thư mục của task.',
        retryable: false,
      });
    }
    current = parent;
    directories.push(current);
  }
  return directories;
}

/** The first tracked managed folder (relative to the root, forward slashes), or null. */
async function findTrackedCandidate(
  rootDirectory: string,
  candidates: readonly string[],
): Promise<string | null> {
  const output = await runGit(rootDirectory, [
    'ls-files',
    '-z',
    '--',
    ...candidates.map(
      (candidate) =>
        `:(literal,icase)${path.relative(rootDirectory, candidate).split(path.sep).join('/')}`,
    ),
  ]);
  const trackedFile = output.split('\0').find((file) => file !== '');
  if (trackedFile === undefined) return null;
  const segments = trackedFile.split('/');
  const managed = ENGINE_MANAGED_WORKSPACE_PATHS.map((name) => name.toLowerCase());
  const folderIndex = segments.findIndex((segment) => managed.includes(segment.toLowerCase()));
  return folderIndex === -1 ? trackedFile : segments.slice(0, folderIndex + 1).join('/');
}

async function removeCandidates(candidates: readonly string[]): Promise<void> {
  for (const candidate of candidates) await removeCandidate(candidate);
}

/** A link is removed itself and never followed; a regular folder or file goes entirely. */
async function removeCandidate(candidate: string): Promise<void> {
  let entry: Stats;
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
      {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: buildGitEnvironmentWithoutPathspecOverrides(),
      },
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
