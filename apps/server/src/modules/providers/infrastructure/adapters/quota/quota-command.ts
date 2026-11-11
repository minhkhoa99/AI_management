import { type ResolvedExecutable, streamCliOutput } from '../engines/cli-process';

const QUOTA_COMMAND_TIMEOUT_MS = 20_000;
const QUOTA_STDOUT_MAX_BYTES = 1024 * 1024;

export interface QuotaCommandInput {
  executable: ResolvedExecutable;
  args: string[];
  workingDirectory: string;
  /** Overridable so tests need not wait the full 20 s. */
  timeoutMs?: number;
}

export interface QuotaCommandOutput {
  stdout: string;
  exitCode: number | null;
  stderrTail: string;
  timedOut: boolean;
}

/**
 * Runs a quota-reading CLI command without a shell. A timeout kills the whole process tree
 * (CLIs spawn sub-processes), and stdout beyond 1 MiB is dropped. Spawn failures propagate.
 */
export async function readQuotaCommandOutput(
  input: QuotaCommandInput,
): Promise<QuotaCommandOutput> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? QUOTA_COMMAND_TIMEOUT_MS);
  const lines: string[] = [];
  let collectedBytes = 0;
  let exitCode: number | null = null;
  let stderrTail = '';
  let timedOut = false;
  for await (const item of streamCliOutput(
    {
      executable: input.executable,
      args: input.args,
      workingDirectory: input.workingDirectory,
      stdinText: '',
    },
    signal,
  )) {
    if (item.kind === 'exit') {
      ({ exitCode, stderrTail } = item);
      timedOut = item.cancelled;
    } else if (collectedBytes < QUOTA_STDOUT_MAX_BYTES) {
      lines.push(item.text);
      collectedBytes += Buffer.byteLength(item.text) + 1;
    }
  }
  return { stdout: lines.join('\n'), exitCode, stderrTail, timedOut };
}
