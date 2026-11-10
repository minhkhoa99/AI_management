/**
 * Folders in a worktree that a CLI engine loads configuration from and that can make it run
 * commands (hooks, MCP, plugins, subagents, config-folder redirects). They are never committed
 * and are deleted before an engine run that reads them.
 */
export const ENGINE_MANAGED_WORKSPACE_PATHS: readonly string[] = [
  '.agents',
  '.agent',
  '_agents',
  '_agent',
  '.gemini',
];
