import { execFile } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../../../app-runtime-config';
import { AppError } from '../../../../shared/errors/app-error';
import { ValidationError } from '../../../../shared/errors/app-error';
import { ENGINE_MANAGED_WORKSPACE_PATHS } from '../../../../shared/runtime/engine-managed-paths';
import {
  buildGitEnvironmentWithoutPathspecOverrides,
  SAFE_GIT_OPTIONS,
} from '../../../../shared/runtime/safe-git-options';
import type {
  PreparedTaskWorkspace,
  SavedCheckpoint,
  TaskWorkspace,
  WorkspaceFile,
} from '../../application/ports/task-execution.ports';
import { resolveInsideWorktree } from '../../domain/workspace-paths';

const GIT_TIMEOUT_MS = 120_000;
/** Commits made by the platform; the user's own git identity is never needed or changed. */
const PLATFORM_IDENTITY = ['-c', 'user.name=AI Team', '-c', 'user.email=aiteam@localhost'];
/** QA documents are copied here inside the worktree and kept out of git. */
const QA_FOLDER = '.aiteam-qa';
/** The agent's skills are copied here inside the worktree and kept out of git. */
const SKILLS_FOLDER = '.aiteam-skills';
const MAX_LISTED_FILES = 5_000;
const MAX_FILE_BYTES = 512 * 1024;
function requireCommitSha(sha: string): string {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    throw new ValidationError('Mã commit không hợp lệ.', { code: 'COMMIT_SHA_INVALID' });
  }
  return sha;
}

/**
 * One git worktree per task (branch agent/<taskId>) under ~/.aiteam/data/worktrees, so agents
 * never touch the files the user is editing. git runs without a shell, with fixed arguments.
 */
@Injectable()
export class GitTaskWorkspace implements TaskWorkspace {
  private readonly worktreesRoot: string;
  private readonly createdFoldersRoot: string;

  constructor(@Inject(APP_RUNTIME_CONFIG) runtimeConfig: AppRuntimeConfig) {
    this.worktreesRoot = path.join(runtimeConfig.dataDirectory, 'worktrees');
    this.createdFoldersRoot = path.join(runtimeConfig.dataDirectory, 'task-folders');
  }

  async prepareTaskWorkspace(input: {
    taskId: string;
    workingDirectory: string | null;
    worktreePath: string | null;
    qaDocuments: ReadonlyArray<{ fileName: string; contentPath: string }>;
    forkFromTaskId?: string | null;
    skills?: ReadonlyArray<{ slug: string; folder: string }>;
  }): Promise<PreparedTaskWorkspace> {
    const forkFromTaskId = input.forkFromTaskId ?? null;
    // A subtask of a task without a chosen folder works in the folder created for its parent.
    const sourceDirectory =
      input.workingDirectory ?? path.join(this.createdFoldersRoot, forkFromTaskId ?? input.taskId);
    mkdirSync(sourceDirectory, { recursive: true });
    const repositoryRoot = await this.ensureRepository(sourceDirectory);
    const relativeFolder = path.relative(repositoryRoot, sourceDirectory);
    const worktreePath = input.worktreePath ?? path.join(this.worktreesRoot, input.taskId);
    let baseSha: string | null = null;

    if (!existsSync(path.join(worktreePath, '.git'))) {
      mkdirSync(this.worktreesRoot, { recursive: true });
      // Left over from an interrupted removal: start clean.
      rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3 });
      await this.runGit(repositoryRoot, ['worktree', 'prune']);
      const branch = taskBranchName(input.taskId);
      const branchExists = await this.succeeds(repositoryRoot, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branch}`,
      ]);
      await this.runGit(
        repositoryRoot,
        branchExists
          ? ['worktree', 'add', worktreePath, branch]
          : [
              'worktree',
              'add',
              '-b',
              branch,
              worktreePath,
              forkFromTaskId === null ? 'HEAD' : taskBranchName(forkFromTaskId),
            ],
      );
      baseSha = branchExists
        ? null
        : (await this.runGit(worktreePath, ['rev-parse', 'HEAD'])).trim();
    }

    const agentDirectory = path.join(worktreePath, relativeFolder);
    mkdirSync(agentDirectory, { recursive: true });
    // An agent could have replaced the folder with a link to somewhere else.
    if (relativeFolder !== '') resolveInsideWorktree(worktreePath, relativeFolder);
    const qaDocumentPaths = await this.copyQaDocuments(
      worktreePath,
      agentDirectory,
      input.qaDocuments,
    );
    const skillManifestPaths = await this.copySkills(
      worktreePath,
      agentDirectory,
      input.skills ?? [],
    );
    return { worktreePath, agentDirectory, qaDocumentPaths, skillManifestPaths, baseSha };
  }

  async saveCheckpoint(worktreePath: string, message: string): Promise<SavedCheckpoint | null> {
    if (!existsSync(worktreePath)) return null;
    // Changes to files the project already tracks are always saved, whatever their name.
    await this.runGit(worktreePath, ['add', '-u', '--', '.']);
    // New files under engine-managed folder names are never committed, whatever the engine.
    // Pathspecs, not info/exclude: that file is shared with the user's own checkout and loses
    // against a `!` rule in a .gitignore the agent wrote.
    await this.runGit(worktreePath, [
      'add',
      '-A',
      '--',
      '.',
      ...ENGINE_MANAGED_WORKSPACE_PATHS.map((name) => `:(exclude,icase,glob)**/${name}/**`),
    ]);
    const hasChanges = !(await this.succeeds(worktreePath, [
      'diff',
      '--no-ext-diff',
      '--cached',
      '--quiet',
    ]));
    if (!hasChanges) return null;
    await this.runGit(worktreePath, [
      ...PLATFORM_IDENTITY,
      'commit',
      '--no-verify',
      '-q',
      '-m',
      message,
    ]);
    const sha = (await this.runGit(worktreePath, ['rev-parse', 'HEAD'])).trim();
    const files = (
      await this.runGit(worktreePath, ['show', '--no-ext-diff', '--name-only', '--format=', 'HEAD'])
    )
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    return { sha, files };
  }

  async mergeSubtaskBranch(
    parentWorktreePath: string,
    subtaskId: string,
    message: string,
  ): Promise<'merged' | 'conflict'> {
    try {
      await this.runGit(parentWorktreePath, [
        ...PLATFORM_IDENTITY,
        'merge',
        '--no-ff',
        '--no-edit',
        '-m',
        message,
        taskBranchName(subtaskId),
      ]);
      return 'merged';
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'GIT_COMMAND_FAILED') throw error;
      // Conflict (or a dirty parent worktree): leave the parent exactly as it was.
      await this.succeeds(parentWorktreePath, ['merge', '--abort']);
      return 'conflict';
    }
  }

  async removeTaskWorkspace(worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) return;
    // Run from the main repository: on Windows git cannot delete a folder it is running in.
    const commonDirectory = (
      await this.runGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    await this.runGit(commonDirectory, ['worktree', 'remove', '--force', worktreePath]);
  }

  async locateAgentFolder(workingDirectory: string | null): Promise<string> {
    if (workingDirectory === null || !existsSync(workingDirectory)) return '';
    const prefix = (await this.runGit(workingDirectory, ['rev-parse', '--show-prefix'])).trim();
    return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  }

  async listWorkspaceFiles(worktreePath: string): Promise<string[]> {
    const output = await this.runGit(worktreePath, [
      '-c',
      'core.quotepath=false',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    return [...new Set(output.split('\0').filter((file) => file !== ''))]
      .sort()
      .slice(0, MAX_LISTED_FILES);
  }

  async readWorkspaceFile(worktreePath: string, relativePath: string): Promise<WorkspaceFile> {
    const absolutePath = resolveInsideWorktree(worktreePath, relativePath);
    const fileStat = statSync(absolutePath);
    if (!fileStat.isFile()) {
      // A FIFO or device opened synchronously would block the whole server.
      throw new ValidationError('Chỉ xem được file thường.', {
        code: 'WORKSPACE_FILE_NOT_REGULAR',
      });
    }
    const size = fileStat.size;
    const fileDescriptor = openSync(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, MAX_FILE_BYTES));
      readSync(fileDescriptor, buffer, 0, buffer.length, 0);
      const binary = buffer.subarray(0, 8_000).includes(0);
      return {
        path: relativePath,
        size,
        binary,
        truncated: size > MAX_FILE_BYTES,
        content: binary ? null : buffer.toString('utf8'),
      };
    } finally {
      closeSync(fileDescriptor);
    }
  }

  readCommitPatch(worktreePath: string, sha: string): Promise<string> {
    return this.runGit(worktreePath, [
      '-c',
      'core.quotepath=false',
      'show',
      '--no-ext-diff',
      '--format=',
      '--patch',
      '--find-renames',
      '--no-color',
      requireCommitSha(sha),
    ]);
  }

  async readRangePatch(
    worktreePath: string,
    fromSha: string | null,
    toSha: string,
  ): Promise<string> {
    const from = fromSha ?? (await this.findFirstCommit(worktreePath));
    return this.runGit(worktreePath, [
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-ext-diff',
      '--find-renames',
      '--no-color',
      `${requireCommitSha(from)}..${requireCommitSha(toSha)}`,
    ]);
  }

  async revertWorkspaceFile(
    worktreePath: string,
    baseSha: string | null,
    relativePath: string,
  ): Promise<void> {
    const absolutePath = resolveInsideWorktree(worktreePath, relativePath, { mayBeMissing: true });
    const base = requireCommitSha(baseSha ?? (await this.findFirstCommit(worktreePath)));
    const gitPath = relativePath.split(path.sep).join('/');
    const existedAtBase = await this.succeeds(worktreePath, [
      'cat-file',
      '-e',
      `${base}:${gitPath}`,
    ]);
    if (existedAtBase) {
      // Literal: a name with glob characters must not revert other files.
      await this.runGit(worktreePath, ['--literal-pathspecs', 'checkout', base, '--', gitPath]);
    } else {
      rmSync(absolutePath, { force: true });
    }
  }

  private async findFirstCommit(worktreePath: string): Promise<string> {
    const roots = (await this.runGit(worktreePath, ['rev-list', '--max-parents=0', 'HEAD'])).trim();
    return roots.split(/\r?\n/).at(-1) ?? '';
  }

  /** The repository root of the folder; git init + a first commit when there is none yet. */
  private async ensureRepository(sourceDirectory: string): Promise<string> {
    const insideRepository = await this.succeeds(sourceDirectory, [
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    if (!insideRepository) {
      await this.runGit(sourceDirectory, ['init', '-q']);
    }
    const repositoryRoot = path.resolve(
      (await this.runGit(sourceDirectory, ['rev-parse', '--show-toplevel'])).trim(),
    );
    const hasCommit = await this.succeeds(repositoryRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      'HEAD',
    ]);
    if (!hasCommit) {
      await this.runGit(repositoryRoot, ['add', '-A']);
      await this.runGit(repositoryRoot, [
        ...PLATFORM_IDENTITY,
        'commit',
        '--no-verify',
        '--allow-empty',
        '-q',
        '-m',
        'aiteam: ảnh chụp ban đầu',
      ]);
    }
    return repositoryRoot;
  }

  /**
   * Rebuilds .aiteam-skills/ with exactly the agent's skills: anything the agent changed, added
   * or linked there is thrown away first (a link is removed, never followed).
   */
  private async copySkills(
    worktreePath: string,
    agentDirectory: string,
    skills: ReadonlyArray<{ slug: string; folder: string }>,
  ): Promise<Map<string, string>> {
    const skillsDirectory = path.join(agentDirectory, SKILLS_FOLDER);
    removeUnlessRealEntry(skillsDirectory, 'directory');
    rmSync(skillsDirectory, { recursive: true, force: true });
    const manifestPaths = new Map<string, string>();
    if (skills.length === 0) return manifestPaths;
    mkdirSync(skillsDirectory, { recursive: true });
    await this.excludeFromGit(worktreePath, SKILLS_FOLDER);
    for (const skill of skills) {
      if (!existsSync(skill.folder)) continue;
      cpSync(skill.folder, path.join(skillsDirectory, skill.slug), { recursive: true });
      manifestPaths.set(skill.slug, path.posix.join(SKILLS_FOLDER, skill.slug, 'SKILL.md'));
    }
    return manifestPaths;
  }

  private async copyQaDocuments(
    worktreePath: string,
    agentDirectory: string,
    documents: ReadonlyArray<{ fileName: string; contentPath: string }>,
  ): Promise<string[]> {
    if (documents.length === 0) return [];
    const qaDirectory = path.join(agentDirectory, QA_FOLDER);
    removeUnlessRealEntry(qaDirectory, 'directory');
    mkdirSync(qaDirectory, { recursive: true });
    await this.excludeFromGit(worktreePath, QA_FOLDER);
    return documents.map((document) => {
      // File names were validated as bare names when uploaded; basename keeps it that way.
      const fileName = path.basename(document.fileName);
      const target = path.join(qaDirectory, fileName);
      removeUnlessRealEntry(target, 'file');
      copyFileSync(document.contentPath, target);
      return path.posix.join(QA_FOLDER, fileName);
    });
  }

  private async excludeFromGit(worktreePath: string, folder: string): Promise<void> {
    const excludePath = path.resolve(
      worktreePath,
      (await this.runGit(worktreePath, ['rev-parse', '--git-path', 'info/exclude'])).trim(),
    );
    const pattern = `${folder}/`;
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (!current.split(/\r?\n/).includes(pattern)) {
      mkdirSync(path.dirname(excludePath), { recursive: true });
      appendFileSync(
        excludePath,
        `${current.endsWith('\n') || current === '' ? '' : '\n'}${pattern}\n`,
      );
    }
  }

  private async succeeds(directory: string, args: string[]): Promise<boolean> {
    try {
      await this.runGit(directory, args);
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === 'GIT_COMMAND_FAILED') return false;
      throw error;
    }
  }

  private runGit(directory: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        [...SAFE_GIT_OPTIONS, '-C', directory, ...args],
        {
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
          env: buildGitEnvironmentWithoutPathspecOverrides(),
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
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
}

/**
 * The agent can turn `.aiteam-qa` (or a file in it) into a symlink or junction; copying the
 * user's documents through it would write outside the worktree. Anything that is not a real
 * entry of the expected kind is removed (a link is removed, not what it points to).
 */
function removeUnlessRealEntry(entryPath: string, kind: 'directory' | 'file'): void {
  let entry;
  try {
    entry = lstatSync(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const isExpected = kind === 'directory' ? entry.isDirectory() : entry.isFile();
  if (!isExpected || entry.isSymbolicLink()) {
    rmSync(entryPath, { recursive: true, force: true });
  }
}

/** Every task works on its own branch, kept after the task is deleted. */
function taskBranchName(taskId: string): string {
  return `agent/${taskId}`;
}
