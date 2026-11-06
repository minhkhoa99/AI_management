import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { EngineUnavailableError } from '../../../../../shared/errors/app-error';

export interface ResolvedExecutable {
  command: string;
  /** Arguments placed before the CLI's own (the script path when running an npm shim). */
  leadingArgs: string[];
}

export interface CliInvocation {
  executable: ResolvedExecutable;
  args: string[];
  workingDirectory: string;
  /** Prompt text; sent on stdin so it never goes through argument parsing or a shell. */
  stdinText: string;
}

export type CliOutput =
  | { kind: 'line'; text: string }
  | {
      kind: 'exit';
      exitCode: number | null;
      /** Last part of stderr, for error messages (never parsed as events). */
      stderrTail: string;
      cancelled: boolean;
    };

const STDERR_TAIL_BYTES = 8 * 1024;
const FORCE_KILL_DELAY_MS = 3_000;

/**
 * Finds a CLI on PATH without using a shell. On Windows a native .exe is preferred; an npm
 * ".cmd" shim cannot be spawned without a shell (CVE-2024-27980), so the Node script it wraps is
 * run with the current Node binary instead.
 */
export function resolveCliExecutable(executableName: string): ResolvedExecutable {
  if (process.platform !== 'win32') {
    const found = findOnPath(executableName, ['']);
    if (found === undefined) {
      throw createCliMissingError(executableName);
    }
    return { command: found, leadingArgs: [] };
  }
  const native = findOnPath(executableName, ['.exe']);
  if (native !== undefined) {
    return { command: native, leadingArgs: [] };
  }
  const shim = findOnPath(executableName, ['.cmd']);
  const shimScript = shim === undefined ? undefined : readNpmShimScript(shim);
  if (shimScript !== undefined) {
    return { command: process.execPath, leadingArgs: [shimScript] };
  }
  throw createCliMissingError(executableName);
}

function findOnPath(executableName: string, extensions: readonly string[]): string | undefined {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, executableName + extension);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** npm cmd shims end with: "%_prog%" "%dp0%\node_modules\<pkg>\bin\<cli>.js" %* */
function readNpmShimScript(shimPath: string): string | undefined {
  const match = /"%dp0%\\([^"]+\.(?:c|m)?js)"/i.exec(readFileSync(shimPath, 'utf8'));
  if (match?.[1] === undefined) {
    return undefined;
  }
  const scriptPath = path.join(path.dirname(shimPath), match[1]);
  return existsSync(scriptPath) ? scriptPath : undefined;
}

function createCliMissingError(executableName: string): EngineUnavailableError {
  return new EngineUnavailableError(`Không tìm thấy lệnh "${executableName}" trên máy.`, {
    code: 'ENGINE_NOT_INSTALLED',
  });
}

/**
 * Runs a CLI and yields its stdout line by line, then one `exit` item. Aborting the signal kills
 * the whole process tree (CLIs spawn tools and sub-processes of their own).
 */
export async function* streamCliOutput(
  invocation: CliInvocation,
  signal: AbortSignal,
): AsyncGenerator<CliOutput> {
  const child = spawn(
    invocation.executable.command,
    [...invocation.executable.leadingArgs, ...invocation.args],
    {
      cwd: invocation.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Own process group on POSIX so the whole tree can be signalled.
      detached: process.platform !== 'win32',
    },
  );

  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  const exitCodePromise = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode));
  });
  // Spawn failures surface through the exit promise; keep it from being reported as unhandled.
  exitCodePromise.catch(() => undefined);

  let cancelled = false;
  const stopOnAbort = () => {
    cancelled = true;
    terminateProcessTree(child);
  };
  if (signal.aborted) {
    stopOnAbort();
  } else {
    signal.addEventListener('abort', stopOnAbort, { once: true });
  }

  child.stdin?.on('error', () => {
    // EPIPE when the CLI exits before reading stdin; the exit code reports the real problem.
  });
  child.stdin?.end(invocation.stdinText);

  try {
    if (child.stdout !== null) {
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        if (line.trim().length > 0) {
          yield { kind: 'line', text: line };
        }
      }
    }
    let exitCode: number | null;
    try {
      exitCode = await exitCodePromise;
    } catch (error) {
      throw new EngineUnavailableError(
        `Không chạy được ${path.basename(invocation.executable.command)}.`,
        {
          code: 'ENGINE_START_FAILED',
          cause: error,
        },
      );
    }
    yield { kind: 'exit', exitCode, stderrTail, cancelled };
  } finally {
    signal.removeEventListener('abort', stopOnAbort);
    if (child.exitCode === null && child.signalCode === null) {
      // Consumer stopped early (break/return): do not leave the CLI running.
      terminateProcessTree(child);
    }
  }
}

export function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => child.kill());
    return;
  }
  const processGroupId = -child.pid;
  try {
    process.kill(processGroupId, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
    return;
  }
  setTimeout(() => {
    try {
      process.kill(processGroupId, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
  }, FORCE_KILL_DELAY_MS).unref();
}
