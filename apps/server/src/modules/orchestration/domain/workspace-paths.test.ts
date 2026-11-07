import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toWorktreeRelativePath } from './workspace-paths';

describe('toWorktreeRelativePath', () => {
  const worktree = path.resolve('aiteam-worktrees', 'task-1');
  const agentFolder = path.join(worktree, 'api');

  it('turns an absolute path inside the worktree into a forward-slash relative path', () => {
    // Regression: Claude Code reports absolute paths; the monitor then asked the file API for an
    // absolute path and got 400.
    expect(
      toWorktreeRelativePath(worktree, agentFolder, path.join(worktree, 'src', 'math.js')),
    ).toBe('src/math.js');
  });

  it('resolves a relative path against the agent working directory', () => {
    expect(toWorktreeRelativePath(worktree, agentFolder, 'docs/math.md')).toBe('api/docs/math.md');
  });

  it('returns null for paths outside the worktree or unusable ones', () => {
    expect(toWorktreeRelativePath(worktree, agentFolder, '../../elsewhere.txt')).toBeNull();
    expect(toWorktreeRelativePath(worktree, agentFolder, path.resolve('other', 'x.js'))).toBeNull();
    expect(toWorktreeRelativePath(worktree, worktree, '.')).toBeNull();
    expect(toWorktreeRelativePath(worktree, agentFolder, 'a\0b')).toBeNull();
    expect(toWorktreeRelativePath(worktree, agentFolder, '')).toBeNull();
  });

  it('keeps file names that merely start with two dots', () => {
    expect(toWorktreeRelativePath(worktree, worktree, '..notes.md')).toBe('..notes.md');
  });
});
