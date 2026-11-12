import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { EngineUnavailableError } from '../../../../../shared/errors/app-error';
import type { CliProcessTracker } from '../../../../../shared/runtime/cli-process-tracker';
import { osProcessTerminator } from '../../../../../shared/runtime/process-termination';

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
  /** Keep stdin open after writing (JSON-RPC servers quit on EOF); the process is killed on abort. */
  keepStdinOpen?: boolean;
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

/** Where to look for a CLI; overridable so tests can lay out a PATH of their own. */
export interface CliSearchEnvironment {
  platform: NodeJS.Platform;
  pathValue: string;
  nodeExecutablePath: string;
}

const PROCESS_SEARCH_ENVIRONMENT = (): CliSearchEnvironment => ({
  platform: process.platform,
  pathValue: process.env.PATH ?? '',
  nodeExecutablePath: process.execPath,
});

/**
 * Finds a CLI on PATH without using a shell, the way the owner's terminal does: PATH directories in
 * order, the first one holding the command wins (several installs of one CLI are common). On
 * Windows a directory's native .exe beats its npm ".cmd" shim; a shim cannot be spawned without a
 * shell (CVE-2024-27980), so the Node script it wraps is run with the current Node binary instead.
 */
export function resolveCliExecutable(
  executableName: string,
  environment: CliSearchEnvironment = PROCESS_SEARCH_ENVIRONMENT(),
): ResolvedExecutable {
  const isWindows = environment.platform === 'win32';
  const pathFlavour = isWindows ? path.win32 : path.posix;
  // Quoted entries are valid on Windows. Relative entries are skipped: spawn would resolve them
  // against the task worktree, where an agent can write a fake CLI.
  const directories = environment.pathValue
    .split(isWindows ? ';' : ':')
    .map((entry) => (isWindows ? entry.trim().replace(/^"(.*)"$/, '$1') : entry))
    .filter((entry) => entry !== '' && pathFlavour.isAbsolute(entry));
  for (const directory of directories) {
    if (!isWindows) {
      const candidate = path.join(directory, executableName);
      if (existsSync(candidate)) return { command: candidate, leadingArgs: [] };
      continue;
    }
    const native = path.join(directory, `${executableName}.exe`);
    if (existsSync(native)) return { command: native, leadingArgs: [] };
    const shim = path.join(directory, `${executableName}.cmd`);
    // A .cmd that is not an npm shim cannot run without a shell: keep looking.
    const shimScript = existsSync(shim) ? readNpmShimScript(shim) : undefined;
    if (shimScript !== undefined) {
      return { command: environment.nodeExecutablePath, leadingArgs: [shimScript] };
    }
  }
  throw createCliMissingError(executableName);
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
  processTracker?: CliProcessTracker,
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
  // Recorded so a restart after a crash can kill it if it outlives the server.
  const forgetProcess =
    child.pid === undefined
      ? undefined
      : processTracker?.recordSpawnedProcess(child.pid, invocation.executable.command);

  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  const exitCodePromise = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => {
      forgetProcess?.();
      resolve(exitCode);
    });
  });
  // Spawn failures surface through the exit promise; keep it from being reported as unhandled.
  exitCodePromise.catch(() => undefined);

  let cancelled = false;
  const stopOnAbort = () => {
    cancelled = true;
    stopChildProcessTree(child);
  };
  if (signal.aborted) {
    stopOnAbort();
  } else {
    signal.addEventListener('abort', stopOnAbort, { once: true });
  }

  child.stdin?.on('error', () => {
    // EPIPE when the CLI exits before reading stdin; the exit code reports the real problem.
  });
  if (invocation.keepStdinOpen === true) {
    child.stdin?.write(invocation.stdinText);
  } else {
    child.stdin?.end(invocation.stdinText);
  }

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
      stopChildProcessTree(child);
    }
  }
}

function stopChildProcessTree(child: ChildProcess): void {
  if (child.pid !== undefined && child.exitCode === null) {
    osProcessTerminator.terminateProcessTree(child.pid);
  }
}
