import { spawn } from 'node:child_process';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESS_TERMINATOR,
  type ProcessTerminator,
} from '../../../../shared/runtime/process-termination';
import type {
  TestCommandResult,
  TestCommandRunner,
} from '../../application/ports/task-execution.ports';

const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_TAIL_LENGTH = 4_000;

/**
 * The task's test command ("npm test") is written by the user, like a script in their own
 * terminal, so it runs through the system shell (pipes, &&). Agents never choose it. It is
 * stopped with the whole process tree on timeout or when the task is deleted.
 */
@Injectable()
export class ShellTestCommandRunner implements TestCommandRunner {
  constructor(@Inject(PROCESS_TERMINATOR) private readonly processTerminator: ProcessTerminator) {}

  runTestCommand(
    command: string,
    directory: string,
    signal: AbortSignal,
  ): Promise<TestCommandResult> {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn(command, {
        cwd: directory,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL_LENGTH);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const stop = () => {
        if (child.pid !== undefined && child.exitCode === null) {
          this.processTerminator.terminateProcessTree(child.pid);
        }
      };
      const timer = setTimeout(stop, TEST_TIMEOUT_MS);
      signal.addEventListener('abort', stop, { once: true });
      child.once('error', (error) => {
        clearTimeout(timer);
        resolve({
          passed: false,
          exitCode: null,
          outputTail: `Không chạy được lệnh: ${error.message}`,
        });
      });
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        resolve({ passed: exitCode === 0 && !signal.aborted, exitCode, outputTail: output.trim() });
      });
    });
  }
}
