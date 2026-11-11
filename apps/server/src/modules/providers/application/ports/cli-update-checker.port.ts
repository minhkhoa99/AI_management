import type { CliUpdateNotice } from '@aiteam/contracts';

export const CLI_UPDATE_CHECKER = Symbol('CLI_UPDATE_CHECKER');

/** Engines whose CLI is published on npm (Antigravity is not). */
export type NpmPublishedEngine = 'claude_code' | 'codex';

/** Whether the installed CLI is older than its newest release; new models may need it. */
export interface CliUpdateChecker {
  /** Null when the CLI is current, missing, or either version is unknown. Never throws. */
  findCliUpdate(engine: NpmPublishedEngine): Promise<CliUpdateNotice | null>;
}
