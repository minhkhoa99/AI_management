import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { LocalEngine } from '@aiteam/contracts';
import { AppError } from '../../../../shared/errors/app-error';
import type {
  LocalEngineProbe,
  LocalEngineProbeResult,
} from '../../application/ports/local-engine-probe.port';
import { resolveCliExecutable } from './engines/cli-process';

const runExecutable = promisify(execFile);
const PROBE_TIMEOUT_MS = 20_000;

const ENGINE_COMMANDS: Record<LocalEngine, { executableName: string; statusArgs: string[] }> = {
  claude_code: { executableName: 'claude', statusArgs: ['auth', 'status'] },
  codex: { executableName: 'codex', statusArgs: ['login', 'status'] },
};

/**
 * Runs `<cli> --version` and the CLI's own sign-in status command, without a shell.
 * Note: `codex login status` only reads the stored credentials; an expired refresh token shows
 * up in the first real run (the test run reports it).
 */
@Injectable()
export class CliLocalEngineProbe implements LocalEngineProbe {
  async probeLocalEngine(engine: LocalEngine): Promise<LocalEngineProbeResult> {
    const { executableName, statusArgs } = ENGINE_COMMANDS[engine];
    let executable;
    try {
      executable = resolveCliExecutable(executableName);
    } catch (error) {
      if (error instanceof AppError) {
        return {
          installed: false,
          version: null,
          signedIn: null,
          accountDetail: null,
          problem: error.message,
        };
      }
      throw error;
    }
    const version = await runCommand(executable, ['--version']);
    if (!version.succeeded) {
      return {
        installed: true,
        version: null,
        signedIn: null,
        accountDetail: null,
        problem: version.output,
      };
    }
    const status = await runCommand(executable, statusArgs);
    const signIn =
      engine === 'claude_code' ? readClaudeSignIn(status.output) : readCodexSignIn(status);
    return { installed: true, version: firstLine(version.output), ...signIn };
  }
}

async function runCommand(
  executable: { command: string; leadingArgs: string[] },
  args: string[],
): Promise<{ succeeded: boolean; output: string }> {
  try {
    const { stdout, stderr } = await runExecutable(
      executable.command,
      [...executable.leadingArgs, ...args],
      {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf8',
      },
    );
    return { succeeded: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return {
      succeeded: false,
      output: `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.trim() || failure.message,
    };
  }
}

function readClaudeSignIn(
  output: string,
): Pick<LocalEngineProbeResult, 'signedIn' | 'accountDetail' | 'problem'> {
  try {
    const status = JSON.parse(output) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
    };
    const accountDetail =
      [status.authMethod, status.subscriptionType].filter(Boolean).join(' · ') || null;
    return {
      signedIn: status.loggedIn === true,
      accountDetail,
      problem: status.loggedIn === true ? null : 'Chưa đăng nhập. Chạy: claude rồi gõ /login',
    };
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return { signedIn: null, accountDetail: null, problem: firstLine(output) };
  }
}

function readCodexSignIn(status: {
  succeeded: boolean;
  output: string;
}): Pick<LocalEngineProbeResult, 'signedIn' | 'accountDetail' | 'problem'> {
  const signedIn =
    status.succeeded && /logged in/i.test(status.output) && !/not logged in/i.test(status.output);
  return {
    signedIn,
    accountDetail: signedIn ? firstLine(status.output) : null,
    problem: signedIn ? null : 'Chưa đăng nhập. Chạy: codex login',
  };
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim() !== '')
      ?.trim() ?? text
  );
}
