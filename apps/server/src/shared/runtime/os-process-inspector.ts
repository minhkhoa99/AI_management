import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  normaliseProcessName,
  type ProcessIdentity,
  type ProcessInspector,
} from './process-identity';

const runExecutable = promisify(execFile);
const INSPECT_TIMEOUT_MS = 15_000;

/**
 * Reads a process's name and start time from the OS, without a shell:
 * Linux /proc, macOS `ps`, Windows CIM (Win32_Process.CreationDate) through PowerShell.
 */
export class OsProcessInspector implements ProcessInspector {
  async inspectProcess(pid: number): Promise<ProcessIdentity | null> {
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    if (process.platform === 'linux') {
      return inspectLinuxProcess(pid);
    }
    if (process.platform === 'win32') {
      return inspectWindowsProcess(pid);
    }
    return inspectPosixProcessWithPs(pid);
  }
}

async function inspectLinuxProcess(pid: number): Promise<ProcessIdentity | null> {
  let statLine: string;
  try {
    statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  // Format: "pid (comm) state ppid ... starttime(field 22) ..."; comm may contain spaces.
  const commandStart = statLine.indexOf('(');
  const commandEnd = statLine.lastIndexOf(')');
  const fieldsAfterCommand = statLine.slice(commandEnd + 2).split(' ');
  const startTicks = fieldsAfterCommand[19];
  if (commandStart === -1 || commandEnd === -1 || startTicks === undefined) {
    return null;
  }
  return {
    name: normaliseProcessName(statLine.slice(commandStart + 1, commandEnd)),
    startedAt: `ticks:${startTicks}`,
  };
}

async function inspectWindowsProcess(pid: number): Promise<ProcessIdentity | null> {
  const script =
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; ` +
    "if ($p) { $p.Name + '|' + $p.CreationDate.ToUniversalTime().ToString('o') }";
  const { stdout } = await runExecutable(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      timeout: INSPECT_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
    },
  );
  return parseNameAndStart(stdout.trim(), '|');
}

async function inspectPosixProcessWithPs(pid: number): Promise<ProcessIdentity | null> {
  try {
    const { stdout } = await runExecutable(
      'ps',
      ['-o', 'lstart=', '-o', 'comm=', '-p', String(pid)],
      {
        timeout: INSPECT_TIMEOUT_MS,
        encoding: 'utf8',
      },
    );
    // "Fri Nov  7 10:00:00 2026 /usr/local/bin/claude": the date is the first 24 characters.
    const line = stdout.trim();
    return line === ''
      ? null
      : { name: normaliseProcessName(line.slice(24).trim()), startedAt: line.slice(0, 24) };
  } catch (error) {
    // ps exits with 1 when the PID does not exist.
    if ((error as { code?: unknown }).code === 1) {
      return null;
    }
    throw error;
  }
}

function parseNameAndStart(output: string, separator: string): ProcessIdentity | null {
  const separatorIndex = output.indexOf(separator);
  if (output === '' || separatorIndex === -1) {
    return null;
  }
  return {
    name: normaliseProcessName(output.slice(0, separatorIndex)),
    startedAt: output.slice(separatorIndex + 1),
  };
}
