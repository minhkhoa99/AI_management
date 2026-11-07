import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_RUNTIME_CONFIG, type AppRuntimeConfig } from '../../../../app-runtime-config';
import { AppError } from '../../../../shared/errors/app-error';
import type {
  PreparedTaskWorkspace,
  SavedCheckpoint,
  TaskWorkspace,
} from '../../application/ports/task-execution.ports';

const GIT_TIMEOUT_MS = 120_000;
/** Commits made by the platform; the user's own git identity is never needed or changed. */
const PLATFORM_IDENTITY = ['-c', 'user.name=AI Team', '-c', 'user.email=aiteam@localhost'];
/** QA documents are copied here inside the worktree and kept out of git. */
const QA_FOLDER = '.aiteam-qa';

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
  }): Promise<PreparedTaskWorkspace> {
    const sourceDirectory =
      input.workingDirectory ?? path.join(this.createdFoldersRoot, input.taskId);
    mkdirSync(sourceDirectory, { recursive: true });
    const repositoryRoot = await this.ensureRepository(sourceDirectory);
    const relativeFolder = path.relative(repositoryRoot, sourceDirectory);
    const worktreePath = input.worktreePath ?? path.join(this.worktreesRoot, input.taskId);

    if (!existsSync(path.join(worktreePath, '.git'))) {
      mkdirSync(this.worktreesRoot, { recursive: true });
      // Left over from an interrupted removal: start clean.
      rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3 });
      await this.runGit(repositoryRoot, ['worktree', 'prune']);
      const branch = `agent/${input.taskId}`;
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
          : ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'],
      );
    }

    const agentDirectory = path.join(worktreePath, relativeFolder);
    mkdirSync(agentDirectory, { recursive: true });
    const qaDocumentPaths = await this.copyQaDocuments(
      worktreePath,
      agentDirectory,
      input.qaDocuments,
    );
    return { worktreePath, agentDirectory, qaDocumentPaths };
  }

  async saveCheckpoint(worktreePath: string, message: string): Promise<SavedCheckpoint | null> {
    if (!existsSync(worktreePath)) return null;
    await this.runGit(worktreePath, ['add', '-A']);
    const hasChanges = !(await this.succeeds(worktreePath, ['diff', '--cached', '--quiet']));
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
    const files = (await this.runGit(worktreePath, ['show', '--name-only', '--format=', 'HEAD']))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    return { sha, files };
  }

  async removeTaskWorkspace(worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) return;
    // Run from the main repository: on Windows git cannot delete a folder it is running in.
    const commonDirectory = (
      await this.runGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    await this.runGit(commonDirectory, ['worktree', 'remove', '--force', worktreePath]);
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

  private async copyQaDocuments(
    worktreePath: string,
    agentDirectory: string,
    documents: ReadonlyArray<{ fileName: string; contentPath: string }>,
  ): Promise<string[]> {
    if (documents.length === 0) return [];
    const qaDirectory = path.join(agentDirectory, QA_FOLDER);
    mkdirSync(qaDirectory, { recursive: true });
    await this.excludeFromGit(worktreePath, QA_FOLDER);
    return documents.map((document) => {
      // File names were validated as bare names when uploaded; basename keeps it that way.
      const fileName = path.basename(document.fileName);
      copyFileSync(document.contentPath, path.join(qaDirectory, fileName));
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
        ['-C', directory, ...args],
        {
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
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
