import { devNull } from 'node:os';

/**
 * Before every git command. The worktree is written by agents (Codex runs sandboxed, git here
 * does not): no fsmonitor command, no hooks, no signing program, whatever config it points at.
 */
export const SAFE_GIT_OPTIONS: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${devNull}`,
  '-c',
  'commit.gpgsign=false',
];
