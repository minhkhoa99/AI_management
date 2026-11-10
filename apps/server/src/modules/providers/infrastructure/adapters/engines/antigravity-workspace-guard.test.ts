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

describe('clearEngineManagedPaths', () => {
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

    await clearEngineManagedPaths(root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('removes all five folder names when present', async () => {
    for (const name of FOLDER_NAMES) write(`${name}/hooks.json`);

    await clearEngineManagedPaths(root);

    for (const name of FOLDER_NAMES) expect(existsSync(path.join(root, name))).toBe(false);
  });

  it('also removes them in every parent up to the worktree root', async () => {
    const workingDirectory = path.join(root, 'apps', 'web');
    mkdirSync(workingDirectory, { recursive: true });
    write('.agents/hooks.json');
    write('apps/_agent/hooks.json');
    write('apps/web/.gemini/config.json');

    await clearEngineManagedPaths(workingDirectory);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(path.join(root, 'apps', '_agent'))).toBe(false);
    expect(existsSync(path.join(workingDirectory, '.gemini'))).toBe(false);
  });

  it('does not touch a managed folder above the git root or below the working directory', async () => {
    const above = write('.agents/hooks.json', sandbox);
    const below = write('apps/web/.agents/hooks.json');

    await clearEngineManagedPaths(path.join(root, 'apps'));

    expect(existsSync(above)).toBe(true);
    expect(existsSync(below)).toBe(true);
  });

  it('refuses when the project tracks a file under a managed folder and deletes nothing', async () => {
    const tracked = write('.agents/skills/x.md');
    git('add', '.agents/skills/x.md');
    git('commit', '-q', '-m', 'agents');
    const untracked = write('.gemini/config.json');

    await expect(clearEngineManagedPaths(root)).rejects.toMatchObject({
      code: 'ENGINE_WORKSPACE_UNSUPPORTED',
      retryable: false,
      message: expect.stringContaining('(.agents)'),
    });

    expect(existsSync(tracked)).toBe(true);
    expect(existsSync(untracked)).toBe(true);
  });

  it('removes a link without following it', async () => {
    const outside = path.join(sandbox, 'outside');
    const outsideHooks = write('hooks.json', outside);
    symlinkSync(outside, path.join(root, '.agents'), 'junction');

    await clearEngineManagedPaths(root);

    expect(existsSync(path.join(root, '.agents'))).toBe(false);
    expect(existsSync(outsideHooks)).toBe(true);
  });

  it('removes a regular file that has a managed name', async () => {
    write('.agent');

    await clearEngineManagedPaths(root);

    expect(existsSync(path.join(root, '.agent'))).toBe(false);
  });

  it('outside a git repository only the working directory is cleaned', async () => {
    const plain = path.join(sandbox, 'plain');
    const workingDirectory = path.join(plain, 'sub');
    mkdirSync(workingDirectory, { recursive: true });
    const parentFolder = write('.agents/hooks.json', plain);
    write('.agents/hooks.json', workingDirectory);

    await clearEngineManagedPaths(workingDirectory);

    expect(existsSync(path.join(workingDirectory, '.agents'))).toBe(false);
    expect(existsSync(parentFolder)).toBe(true);
  });
});
