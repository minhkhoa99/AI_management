import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitTaskWorkspace } from './git-task-workspace';

/** The agent's worktree is untrusted: these cover what an agent could plant there. */
describe('GitTaskWorkspace with agent-planted files', () => {
  let rootDirectory: string;
  let repositoryDirectory: string;
  let workspace: GitTaskWorkspace;

  beforeEach(() => {
    rootDirectory = mkdtempSync(path.join(tmpdir(), 'aiteam-git-workspace-'));
    repositoryDirectory = path.join(rootDirectory, 'project');
    mkdirSync(repositoryDirectory);
    // No newlines: git may convert them to CRLF on checkout (core.autocrlf on Windows).
    writeFileSync(path.join(repositoryDirectory, 'a.txt'), 'a');
    writeFileSync(path.join(repositoryDirectory, '[ab].txt'), 'literal');
    workspace = new GitTaskWorkspace({
      version: 'test',
      startedAtEpochMs: 0,
      sessionToken: 'unused',
      listenPort: 0,
      secretKeyFilePath: path.join(rootDirectory, 'secret.key'),
      dataDirectory: path.join(rootDirectory, 'data'),
    });
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  async function prepare(qaDocuments: Array<{ fileName: string; contentPath: string }> = []) {
    return workspace.prepareTaskWorkspace({
      taskId: 'task-1',
      workingDirectory: repositoryDirectory,
      worktreePath: null,
      qaDocuments,
    });
  }

  it('never runs repository hooks when saving a checkpoint', async () => {
    const { worktreePath } = await prepare();
    const marker = path.join(rootDirectory, 'hook-ran.txt');
    const hookPath = path.join(repositoryDirectory, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, `#!/bin/sh\necho ran > "${marker.split(path.sep).join('/')}"\n`);
    chmodSync(hookPath, 0o755);
    writeFileSync(path.join(worktreePath, 'b.txt'), 'b\n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses to open something that is not a regular file', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, 'docs.md'));

    await expect(workspace.readWorkspaceFile(worktreePath, 'docs.md')).rejects.toMatchObject({
      code: 'WORKSPACE_FILE_NOT_REGULAR',
    });
  });

  it('reverts only the file named, even when the name looks like a glob', async () => {
    const { worktreePath } = await prepare();
    writeFileSync(path.join(worktreePath, 'a.txt'), 'changed a');
    writeFileSync(path.join(worktreePath, '[ab].txt'), 'changed literal');

    await workspace.revertWorkspaceFile(worktreePath, null, '[ab].txt');

    expect(readFileSync(path.join(worktreePath, '[ab].txt'), 'utf8')).toBe('literal');
    expect(readFileSync(path.join(worktreePath, 'a.txt'), 'utf8')).toBe('changed a');
  });

  it('does not copy QA documents through a link the agent put in place of .aiteam-qa', async () => {
    const { worktreePath } = await prepare();
    const outside = path.join(rootDirectory, 'outside');
    mkdirSync(outside);
    // A junction needs no admin rights on Windows; elsewhere the type is ignored (symlink).
    symlinkSync(outside, path.join(worktreePath, '.aiteam-qa'), 'junction');
    const document = path.join(rootDirectory, 'spec.md');
    writeFileSync(document, '# Spec\n');

    const prepared = await workspace.prepareTaskWorkspace({
      taskId: 'task-1',
      workingDirectory: repositoryDirectory,
      worktreePath,
      qaDocuments: [{ fileName: 'spec.md', contentPath: document }],
    });

    expect(existsSync(path.join(outside, 'spec.md'))).toBe(false);
    expect(readFileSync(path.join(worktreePath, '.aiteam-qa', 'spec.md'), 'utf8')).toBe('# Spec\n');
    expect(prepared.qaDocumentPaths).toEqual(['.aiteam-qa/spec.md']);
  });

  it('keeps engine-managed folders out of checkpoints at any depth', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, 'sub', '_agent', 'plugins', 'p'), { recursive: true });
    mkdirSync(path.join(worktreePath, '.agents'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'sub', '_agent', 'plugins', 'p', 'hooks.json'), '{}');
    mkdirSync(path.join(worktreePath, '.Gemini'));
    writeFileSync(path.join(worktreePath, '.Gemini', 'x'), '{}');
    // A rule the agent wrote must not bring the folders back.
    writeFileSync(path.join(worktreePath, '.gitignore'), '!.agents/\n!_agent/\n');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();

    const tracked = execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' });
    expect(tracked).toContain('normal.txt');
    expect(tracked).not.toContain('hooks.json');
    expect(tracked.toLowerCase()).not.toContain('.gemini');
    // Nothing leaks into the exclude file shared with the user's own checkout.
    const exclude = path.join(repositoryDirectory, '.git', 'info', 'exclude');
    const excludeText = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    for (const name of ['.agents', '.agent', '_agents', '_agent', '.gemini']) {
      expect(excludeText).not.toContain(name);
    }
  });

  it('still excludes managed folders when the environment forces literal pathspecs', async () => {
    const { worktreePath } = await prepare();
    mkdirSync(path.join(worktreePath, '.agents'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');
    const previous = process.env.GIT_LITERAL_PATHSPECS;
    process.env.GIT_LITERAL_PATHSPECS = '1';
    try {
      expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.GIT_LITERAL_PATHSPECS;
      else process.env.GIT_LITERAL_PATHSPECS = previous;
    }

    const tracked = execFileSync('git', ['-C', worktreePath, 'ls-files'], { encoding: 'utf8' });
    expect(tracked).toContain('normal.txt');
    expect(tracked).not.toContain('hooks.json');
  });

  it('keeps checkpointing files the project already tracks under managed names', async () => {
    mkdirSync(path.join(repositoryDirectory, '.gemini'));
    writeFileSync(path.join(repositoryDirectory, '.gemini', 'settings.json'), 'old');
    mkdirSync(path.join(repositoryDirectory, '.agents', 'skills'), { recursive: true });
    writeFileSync(path.join(repositoryDirectory, '.agents', 'skills', 'x.md'), 'x');
    const { worktreePath } = await prepare();
    writeFileSync(path.join(worktreePath, '.gemini', 'settings.json'), 'new');
    rmSync(path.join(worktreePath, '.agents', 'skills', 'x.md'));
    writeFileSync(path.join(worktreePath, '.agents', 'hooks.json'), '{}');
    writeFileSync(path.join(worktreePath, 'normal.txt'), 'n');

    expect(await workspace.saveCheckpoint(worktreePath, 'mốc')).not.toBeNull();

    const changed = execFileSync(
      'git',
      ['-C', worktreePath, 'show', '--name-status', '--format=', 'HEAD'],
      { encoding: 'utf8' },
    );
    expect(changed).toMatch(/M\s+\.gemini\/settings\.json/);
    expect(changed).toMatch(/D\s+\.agents\/skills\/x\.md/);
    expect(changed).toContain('normal.txt');
    expect(changed).not.toContain('hooks.json');
  });
});
