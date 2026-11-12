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

const PATHSPEC_ENVIRONMENT_VARIABLES = [
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
];

/** The user's environment must not change how git reads the pathspecs the platform passes. */
export function buildGitEnvironmentWithoutPathspecOverrides(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of PATHSPEC_ENVIRONMENT_VARIABLES) delete environment[name];
  return environment;
}
