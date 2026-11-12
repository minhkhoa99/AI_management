import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearEngineManagedPaths } from './antigravity-workspace-guard';

const FOLDER_NAMES = ['.agents', '.agent', '_agents', '_agent', '.gemini'];

// These tests spawn real git (slow on Windows), so they get more than the default 5 s under load.
describe('clearEngineManagedPaths', { timeout: 30_000 }, () => {
  let sandbox: string;
  let root: string;

  function git(...args: string[]): void {
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-C', root, ...args],
      { stdio: 'ignore', windowsHide: true },
    );
  }

  function write(relativePath: string, base: string = root): string {
    const target = path.join(base, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'x');
    return target;
  }

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), 'aiteam-guard-')));
    root = path.join(sandbox, 'repo');
    mkdirSync(root);
    git('init', '-q');
    write('README.md');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('removes untracked .agents/ in the working directory and keeps other files', async () => {
    write('.agents/hooks.json');
    write('.agents/mcp_config.json');
    write('.agents/plugins/p/hooks.json');

    await clearEngineManagedPaths(root, root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('removes all five folder names when present', async () => {
    for (const name of FOLDER_NAMES) write(`${name}/hooks.json`);

    await clearEngineManagedPaths(root, root);

    for (const name of FOLDER_NAMES) expect(existsSync(path.join(root, name))).toBe(false);
  });

  it('also removes them in every parent up to the worktree root', async () => {
    const workingDirectory = path.join(root, 'apps', 'web');
    mkdirSync(workingDirectory, { recursive: true });
    write('.agents/hooks.json');
    write('apps/_agent/hooks.json');
    write('apps/web/.gemini/config.json');

    await clearEngineManagedPaths(workingDirectory, root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(path.join(root, 'apps', '_agent'))).toBe(false);
    expect(existsSync(path.join(workingDirectory, '.gemini'))).toBe(false);
  });

  it('does not touch a managed folder above the git root or below the working directory', async () => {
    const above = write('.agents/hooks.json', sandbox);
    const below = write('apps/web/.agents/hooks.json');

    await clearEngineManagedPaths(path.join(root, 'apps'), path.join(root, 'apps'));

    expect(existsSync(above)).toBe(true);
    expect(existsSync(below)).toBe(true);
  });

  it('refuses when the task git tracks a file under a managed folder and deletes nothing', async () => {
    const tracked = write('.agents/skills/x.md');
    git('add', '.agents/skills/x.md');
    git('commit', '-q', '-m', 'agents');
    const untracked = write('.gemini/config.json');

    await expect(clearEngineManagedPaths(root, root)).rejects.toMatchObject({
      code: 'ENGINE_WORKSPACE_UNSUPPORTED',
      retryable: false,
      message:
        'Trong git của task đã có thư mục cấu hình của engine (.agents). Engine Antigravity không chạy khi các thư mục .agents, .agent, _agents, _agent, .gemini được theo dõi bằng git.',
    });

    expect(existsSync(tracked)).toBe(true);
    expect(existsSync(untracked)).toBe(true);
  });

  it('removes a link without following it', async () => {
    const outside = path.join(sandbox, 'outside');
    const outsideHooks = write('hooks.json', outside);
    symlinkSync(outside, path.join(root, '.agents'), 'junction');

    await clearEngineManagedPaths(root, root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(outsideHooks)).toBe(true);
  });

  it('removes a regular file that has a managed name', async () => {
    write('.agent');

    await clearEngineManagedPaths(root, root);

    expect(existsSync(path.join(root, '.agent'))).toBe(false);
  });

  it('with no workspace root only the working directory is cleaned', async () => {
    const workingDirectory = path.join(root, 'sub');
    mkdirSync(workingDirectory);
    const parentFolder = write('.agents/hooks.json');
    write('.agents/hooks.json', workingDirectory);

    await clearEngineManagedPaths(workingDirectory, null);

    expect(existsSync(path.join(workingDirectory, '.agents'))).toBe(false);
    expect(existsSync(parentFolder)).toBe(true);
  });

  it('refuses a case variant of a tracked managed folder and deletes nothing', async () => {
    const tracked = write('.Agents/hooks.json');
    git('add', '.');
    git('commit', '-q', '-m', 'agents');
    const untracked = write('.gemini/config.json');

    await expect(clearEngineManagedPaths(root, root)).rejects.toMatchObject({
      code: 'ENGINE_WORKSPACE_UNSUPPORTED',
      retryable: false,
    });

    expect(existsSync(tracked)).toBe(true);
    expect(existsSync(untracked)).toBe(true);
  });

  it('is not fooled by GIT_LITERAL_PATHSPECS in the environment', async () => {
    write('.agents/hooks.json');
    git('add', '.');
    git('commit', '-q', '-m', 'agents');
    const previous = process.env.GIT_LITERAL_PATHSPECS;
    process.env.GIT_LITERAL_PATHSPECS = '1';
    try {
      await expect(clearEngineManagedPaths(root, root)).rejects.toMatchObject({
        code: 'ENGINE_WORKSPACE_UNSUPPORTED',
      });
    } finally {
      if (previous === undefined) delete process.env.GIT_LITERAL_PATHSPECS;
      else process.env.GIT_LITERAL_PATHSPECS = previous;
    }
    expect(existsSync(path.join(root, '.agents', 'hooks.json'))).toBe(true);
  });

  it('refuses a working directory outside the root and deletes nothing', async () => {
    const elsewhere = path.join(sandbox, 'elsewhere');
    const planted = write('.agents/hooks.json', elsewhere);

    await expect(clearEngineManagedPaths(elsewhere, root)).rejects.toMatchObject({
      code: 'ENGINE_WORKSPACE_UNSUPPORTED',
      retryable: false,
    });

    expect(existsSync(planted)).toBe(true);
  });

  it('turns a missing working directory into an AppError', async () => {
    await expect(clearEngineManagedPaths(path.join(root, 'missing'), root)).rejects.toMatchObject({
      code: 'ENGINE_WORKSPACE_UNSUPPORTED',
    });
  });

  it('cleans every level even when an agent planted a nested .git', async () => {
    const workingDirectory = path.join(root, 'apps', 'web');
    mkdirSync(workingDirectory, { recursive: true });
    execFileSync('git', ['init', '-q', path.join(root, 'apps')], { windowsHide: true });
    write('.agents/hooks.json');
    write('apps/.agent/hooks.json');
    write('apps/web/_agents/hooks.json');

    await clearEngineManagedPaths(workingDirectory, root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(path.join(root, 'apps', '.agent'))).toBe(false);
    expect(existsSync(path.join(workingDirectory, '_agents'))).toBe(false);
  });

  it('does not follow a link nested inside a managed folder', async () => {
    const outside = path.join(sandbox, 'outside');
    const outsideFile = write('keep.txt', outside);
    mkdirSync(path.join(root, '.agents'));
    symlinkSync(outside, path.join(root, '.agents', 'link'), 'junction');

    await clearEngineManagedPaths(root, root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('accepts a working directory whose name merely starts with two dots', async () => {
    const workingDirectory = path.join(root, '..cache');
    mkdirSync(workingDirectory);
    write('.agents/hooks.json', workingDirectory);

    await clearEngineManagedPaths(workingDirectory, root);

    expect(existsSync(path.join(workingDirectory, '.agents'))).toBe(false);
  });
});
