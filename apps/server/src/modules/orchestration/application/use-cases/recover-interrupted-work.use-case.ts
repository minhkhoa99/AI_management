import { Inject, Injectable } from '@nestjs/common';
import {
  CLI_PROCESS_TRACKER,
  type CliProcessTracker,
} from '../../../../shared/runtime/cli-process-tracker';
import {
  isSameProcess,
  PROCESS_INSPECTOR,
  type ProcessInspector,
} from '../../../../shared/runtime/process-identity';
import {
  PROCESS_TERMINATOR,
  type ProcessTerminator,
} from '../../../../shared/runtime/process-termination';
import {
  TASK_RECOVERY_REPOSITORY,
  type TaskRecoveryRepository,
} from '../../domain/repositories/task-recovery.repository';

/** Executables aiteam itself starts for sessions (node = npm shim running the CLI's script). */
const KILLABLE_PROCESS_NAMES = new Set(['claude', 'codex', 'node']);

export interface InterruptedWorkReport {
  killedProcessCount: number;
  leftAloneProcessCount: number;
  requeuedTaskCount: number;
  cancelledTaskCount: number;
}

/**
 * Runs at startup, before the server accepts requests. Cleans up after an abrupt stop:
 * kills orphaned CLI processes of the previous run, but only when PID, name and start time all
 * still match the record (a reused PID belongs to someone else), then repairs task states.
 */
@Injectable()
export class RecoverInterruptedWorkUseCase {
  constructor(
    @Inject(CLI_PROCESS_TRACKER) private readonly processTracker: CliProcessTracker,
    @Inject(PROCESS_INSPECTOR) private readonly processInspector: ProcessInspector,
    @Inject(PROCESS_TERMINATOR) private readonly processTerminator: ProcessTerminator,
    @Inject(TASK_RECOVERY_REPOSITORY)
    private readonly taskRecoveryRepository: TaskRecoveryRepository,
  ) {}

  async recoverInterruptedWork(): Promise<InterruptedWorkReport> {
    let killedProcessCount = 0;
    let leftAloneProcessCount = 0;
    for (const record of this.processTracker.listRecordedProcesses()) {
      const liveProcess = await this.processInspector.inspectProcess(record.pid);
      const isOurOrphan =
        KILLABLE_PROCESS_NAMES.has(record.processName) &&
        isSameProcess(
          { name: record.processName, startedAt: record.processStartedAt },
          liveProcess,
        );
      if (isOurOrphan) {
        this.processTerminator.terminateProcessTree(record.pid);
        killedProcessCount += 1;
      } else if (liveProcess !== null) {
        leftAloneProcessCount += 1;
      }
      this.processTracker.forgetRecordedProcess(record.id);
    }
    return {
      killedProcessCount,
      leftAloneProcessCount,
      requeuedTaskCount: this.taskRecoveryRepository.requeueRunningTasks(),
      cancelledTaskCount: this.taskRecoveryRepository.finishCancellingTasks(),
    };
  }
}
