import { spawn } from 'node:child_process';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESS_TERMINATOR,
  type ProcessTerminator,
} from '../../../../shared/runtime/process-termination';
import type {
  PreviewProcess,
  PreviewProcessLauncher,
  PreviewProcessListeners,
} from '../../application/ports/preview-server.ports';

/**
 * The preview command ("npm run dev -- --port {port}") is written by the user for their own
 * project, like the test command, so it runs through the system shell. Agents never choose it.
 * PORT and HOST tell common dev servers where to listen; the registry still checks that the
 * server answers on loopback only.
 */
@Injectable()
export class ShellPreviewProcessLauncher implements PreviewProcessLauncher {
  constructor(@Inject(PROCESS_TERMINATOR) private readonly processTerminator: ProcessTerminator) {}

  launchPreviewProcess(
    input: { command: string; directory: string; port: number },
    listeners: PreviewProcessListeners,
  ): PreviewProcess {
    let hasExited = false;
    const reportExitOnce = (exitCode: number | null, error?: Error) => {
      if (hasExited) return;
      hasExited = true;
      listeners.reportExit(exitCode, error);
    };
    const child = spawn(input.command, {
      cwd: input.directory,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(input.port),
        HOST: '127.0.0.1',
        BROWSER: 'none',
        FORCE_COLOR: '0',
      },
    });
    const forwardOutput = (chunk: Buffer) => listeners.receiveOutput(chunk.toString('utf8'));
    child.stdout.on('data', forwardOutput);
    child.stderr.on('data', forwardOutput);
    child.once('error', (error) => reportExitOnce(null, error));
    child.once('close', (exitCode) => reportExitOnce(exitCode));
    return {
      stopPreviewProcess: () => {
        if (child.pid !== undefined && child.exitCode === null && !hasExited) {
          this.processTerminator.terminateProcessTree(child.pid);
        }
      },
    };
  }
}
