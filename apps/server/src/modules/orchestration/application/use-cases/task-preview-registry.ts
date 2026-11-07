import { Inject, Injectable, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { PREVIEW_PORT_PLACEHOLDER, type PreviewState, type PreviewStatus } from '@aiteam/contracts';
import { ConflictError } from '../../../../shared/errors/app-error';
import { APP_LOGGER, type AppLogger } from '../../../../shared/logging/app-logger';
import {
  LOCAL_PORT_PROBE,
  type LocalPortProbe,
  PREVIEW_PROCESS_LAUNCHER,
  type PreviewProcess,
  type PreviewProcessLauncher,
} from '../ports/preview-server.ports';

export const PREVIEW_TIMINGS = Symbol('PREVIEW_TIMINGS');

export interface PreviewTimings {
  /** A preview nobody renewed for this long is stopped (the page was closed). */
  leaseMs: number;
  /** How long a server may take before it answers on its port. */
  readyTimeoutMs: number;
  probeIntervalMs: number;
  sweepIntervalMs: number;
}

const DEFAULT_TIMINGS: PreviewTimings = {
  leaseMs: 45_000,
  readyTimeoutMs: 90_000,
  probeIntervalMs: 500,
  sweepIntervalMs: 5_000,
};

/** Dev servers are heavy; a few at a time is plenty on one machine. */
export const MAX_RUNNING_PREVIEWS = 3;
const OUTPUT_TAIL_LENGTH = 6_000;
const STOP_WAIT_MS = 5_000;
// Terminal colour codes from dev servers; the output is shown as plain text.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\u001b\[[0-9;?]*[A-Za-z]/g;

interface PreviewEntry {
  taskId: string;
  commandTemplate: string;
  state: PreviewState;
  port: number | null;
  url: string | null;
  message: string | null;
  output: string;
  leaseUntil: number;
  serverProcess: PreviewProcess | null;
  /** Settles when the server process has ended (or was never started). */
  processEnded: Promise<void>;
  markProcessEnded: () => void;
}

const STOPPED_STATUS: PreviewStatus = {
  state: 'stopped',
  url: null,
  port: null,
  message: null,
  output: '',
};

/**
 * The preview servers that are running, one per task, kept in memory only. A server lives while
 * the page renews its lease, and is always stopped on task deletion and on shutdown. It must
 * listen on loopback only: a server reachable from the network is stopped right away.
 */
@Injectable()
export class TaskPreviewRegistry implements OnApplicationShutdown {
  private readonly previews = new Map<string, PreviewEntry>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly timings: PreviewTimings;
  private readonly stopAllOnExit = () => this.stopAllPreviews();

  constructor(
    @Inject(PREVIEW_PROCESS_LAUNCHER) private readonly processLauncher: PreviewProcessLauncher,
    @Inject(LOCAL_PORT_PROBE) private readonly portProbe: LocalPortProbe,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    @Optional() @Inject(PREVIEW_TIMINGS) timings?: PreviewTimings,
  ) {
    this.timings = timings ?? DEFAULT_TIMINGS;
  }

  describePreview(taskId: string): PreviewStatus {
    const entry = this.previews.get(taskId);
    if (entry === undefined) return STOPPED_STATUS;
    return {
      state: entry.state,
      url: entry.url,
      port: entry.port,
      message: entry.message,
      output: entry.output,
    };
  }

  /**
   * Starts the task's preview, or renews the lease of the one already there. A failed preview
   * stays failed (with its output) until `restart`; a changed command starts again by itself.
   */
  async startOrRenewPreview(
    taskId: string,
    input: { commandTemplate: string; directory: string; restart: boolean },
  ): Promise<PreviewStatus> {
    const existing = this.previews.get(taskId);
    if (existing !== undefined && existing.commandTemplate === input.commandTemplate) {
      const isAlive = existing.state === 'starting' || existing.state === 'running';
      if (isAlive || !input.restart) {
        existing.leaseUntil = Date.now() + this.timings.leaseMs;
        return this.describePreview(taskId);
      }
    }
    if (existing !== undefined) this.stopPreview(taskId);
    if (this.countAlivePreviews() >= MAX_RUNNING_PREVIEWS) {
      throw new ConflictError(
        `Đang có ${MAX_RUNNING_PREVIEWS} bản xem trước chạy. Đóng bớt một bản rồi thử lại.`,
        { code: 'PREVIEW_LIMIT_REACHED' },
      );
    }

    // Registered before the first await, so a second request renews instead of starting twice.
    let markProcessEnded = () => {};
    const processEnded = new Promise<void>((resolve) => {
      markProcessEnded = resolve;
    });
    const entry: PreviewEntry = {
      processEnded,
      markProcessEnded,
      taskId,
      commandTemplate: input.commandTemplate,
      state: 'starting',
      port: null,
      url: null,
      message: null,
      output: '',
      leaseUntil: Date.now() + this.timings.leaseMs,
      serverProcess: null,
    };
    this.previews.set(taskId, entry);
    this.startSweeping();
    try {
      entry.port = await this.portProbe.allocateFreePort();
    } catch (error) {
      entry.markProcessEnded();
      this.failPreview(entry, 'Không tìm được cổng trống cho bản xem trước.');
      this.logger.warn({ err: error, taskId }, 'no free port for preview');
      return this.describePreview(taskId);
    }
    if (this.previews.get(taskId) !== entry) {
      entry.markProcessEnded();
      return this.describePreview(taskId);
    }
    entry.serverProcess = this.processLauncher.launchPreviewProcess(
      {
        command: input.commandTemplate.replaceAll(PREVIEW_PORT_PLACEHOLDER, String(entry.port)),
        directory: input.directory,
        port: entry.port,
      },
      {
        receiveOutput: (text) => {
          entry.output = (entry.output + text.replace(ANSI_ESCAPES, '')).slice(-OUTPUT_TAIL_LENGTH);
        },
        reportExit: (exitCode, error) => {
          entry.serverProcess = null;
          entry.markProcessEnded();
          if (entry.state === 'starting' || entry.state === 'running') {
            this.failPreview(
              entry,
              error === undefined
                ? `Server xem trước đã dừng (mã thoát ${exitCode ?? 'không rõ'}).`
                : `Không chạy được lệnh: ${error.message}`,
            );
          }
        },
      },
    );
    // Never rejects: every failure becomes the preview's "failed" state.
    void this.awaitServerReady(entry);
    return this.describePreview(taskId);
  }

  stopPreview(taskId: string): PreviewStatus {
    const entry = this.previews.get(taskId);
    if (entry !== undefined) {
      entry.state = 'stopped';
      this.previews.delete(taskId);
      entry.serverProcess?.stopPreviewProcess();
      entry.serverProcess = null;
    }
    if (this.previews.size === 0) this.stopSweeping();
    return STOPPED_STATUS;
  }

  /** Stops the preview and waits (bounded) until its process is gone, e.g. before removing files. */
  async stopPreviewAndWait(taskId: string): Promise<void> {
    const entry = this.previews.get(taskId);
    this.stopPreview(taskId);
    if (entry === undefined) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      entry.processEnded,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  onApplicationShutdown(): void {
    this.stopAllPreviews();
  }

  private stopAllPreviews(): void {
    for (const taskId of [...this.previews.keys()]) this.stopPreview(taskId);
  }

  private countAlivePreviews(): number {
    return [...this.previews.values()].filter(
      (entry) => entry.state === 'starting' || entry.state === 'running',
    ).length;
  }

  private failPreview(entry: PreviewEntry, message: string): void {
    entry.state = 'failed';
    entry.url = null;
    entry.message = message;
    entry.serverProcess?.stopPreviewProcess();
    entry.serverProcess = null;
  }

  private async awaitServerReady(entry: PreviewEntry): Promise<void> {
    const deadline = Date.now() + this.timings.readyTimeoutMs;
    try {
      while (entry.state === 'starting' && entry.port !== null) {
        const host = await this.portProbe.findLoopbackHost(entry.port);
        if (entry.state !== 'starting') return;
        if (host !== null) {
          if (await this.portProbe.isReachableFromNetwork(entry.port)) {
            this.failPreview(
              entry,
              'Server xem trước mở ra cả mạng ngoài nên đã bị dừng. Thêm tuỳ chọn chỉ nghe 127.0.0.1 vào lệnh (vd. --host 127.0.0.1).',
            );
            return;
          }
          if (entry.state !== 'starting') return;
          entry.state = 'running';
          entry.url =
            host === '::1' ? `http://[::1]:${entry.port}/` : `http://127.0.0.1:${entry.port}/`;
          return;
        }
        if (Date.now() >= deadline) {
          this.failPreview(
            entry,
            `Server chưa mở cổng ${entry.port} sau ${Math.round(this.timings.readyTimeoutMs / 1000)} giây. Kiểm tra lệnh có dùng {port}.`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, this.timings.probeIntervalMs));
      }
    } catch (error) {
      this.logger.warn({ err: error, taskId: entry.taskId }, 'preview readiness check failed');
      if (entry.state === 'starting') {
        this.failPreview(entry, 'Không kiểm tra được server xem trước.');
      }
    }
  }

  private startSweeping(): void {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = setInterval(() => this.stopExpiredPreviews(), this.timings.sweepIntervalMs);
    this.sweepTimer.unref();
    // A crash exits without Nest shutdown hooks; dev servers must not outlive the platform.
    process.once('exit', this.stopAllOnExit);
  }

  private stopSweeping(): void {
    if (this.sweepTimer === null) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    process.removeListener('exit', this.stopAllOnExit);
  }

  private stopExpiredPreviews(): void {
    const now = Date.now();
    for (const entry of [...this.previews.values()]) {
      if (entry.leaseUntil < now) {
        this.logger.info({ taskId: entry.taskId }, 'preview stopped: page no longer open');
        this.stopPreview(entry.taskId);
      }
    }
  }
}
