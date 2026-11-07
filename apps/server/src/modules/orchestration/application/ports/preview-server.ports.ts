// Ports for the preview tab: the user's dev server, started in the task worktree.

export const PREVIEW_PROCESS_LAUNCHER = Symbol('PREVIEW_PROCESS_LAUNCHER');

export interface PreviewProcess {
  /** Kills the server and everything it started; harmless once it has exited. */
  stopPreviewProcess(): void;
}

export interface PreviewProcessListeners {
  receiveOutput(text: string): void;
  /** Called once when the process ends; `error` when it could not be started at all. */
  reportExit(exitCode: number | null, error?: Error): void;
}

export interface PreviewProcessLauncher {
  /** Runs the user's preview command (port already filled in) in `directory`; never throws. */
  launchPreviewProcess(
    input: { command: string; directory: string; port: number },
    listeners: PreviewProcessListeners,
  ): PreviewProcess;
}

export const LOCAL_PORT_PROBE = Symbol('LOCAL_PORT_PROBE');

export type LoopbackHost = '127.0.0.1' | '::1';

export interface LocalPortProbe {
  /** A port nothing listens on right now (on 127.0.0.1). */
  allocateFreePort(): Promise<number>;
  /** Which loopback address accepts connections on `port`, or null when none does yet. */
  findLoopbackHost(port: number): Promise<LoopbackHost | null>;
  /** True when `port` also accepts connections on a network address of this machine. */
  isReachableFromNetwork(port: number): Promise<boolean>;
}
