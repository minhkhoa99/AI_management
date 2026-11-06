import { spawn } from 'node:child_process';

const FORCE_KILL_DELAY_MS = 3_000;

export const PROCESS_TERMINATOR = Symbol('PROCESS_TERMINATOR');

export interface ProcessTerminator {
  terminateProcessTree(pid: number): void;
}

/**
 * Kills a process and everything it started. Windows: taskkill /T /F. POSIX: the CLI was spawned
 * as its own process group (detached), so the whole group gets SIGTERM, then SIGKILL.
 * A process that is already gone is not an error.
 */
export const osProcessTerminator: ProcessTerminator = {
  terminateProcessTree(pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0) {
      return;
    }
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => signalProcess(pid, 'SIGKILL'));
      return;
    }
    signalProcess(-pid, 'SIGTERM');
    setTimeout(() => signalProcess(-pid, 'SIGKILL'), FORCE_KILL_DELAY_MS).unref();
  },
};

function signalProcess(target: number, signal: NodeJS.Signals): void {
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }
}
