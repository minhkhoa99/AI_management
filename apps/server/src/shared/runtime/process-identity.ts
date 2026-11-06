/** What identifies one OS process over time: PIDs are reused, (name, start time) is not. */
export interface ProcessIdentity {
  /** Executable name, lower-case, without extension ("claude", "codex", "node"). */
  name: string;
  /** Opaque, platform-specific start-time token; only compared for equality. */
  startedAt: string;
}

export const PROCESS_INSPECTOR = Symbol('PROCESS_INSPECTOR');

export interface ProcessInspector {
  /** Identity of a live process, or null when no process has this PID. */
  inspectProcess(pid: number): Promise<ProcessIdentity | null>;
}

export function normaliseProcessName(executableNameOrPath: string): string {
  const baseName = executableNameOrPath.split(/[\\/]/).pop() ?? executableNameOrPath;
  return baseName.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/**
 * True only when the live process is provably the one recorded: same name AND same start time.
 * A missing start time (could not be read when recorded) never matches.
 */
export function isSameProcess(
  recorded: { name: string; startedAt: string | null },
  live: ProcessIdentity | null,
): boolean {
  return (
    live !== null &&
    recorded.startedAt !== null &&
    live.name === recorded.name &&
    live.startedAt === recorded.startedAt
  );
}
