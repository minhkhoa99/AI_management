import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppLogger } from '../logging/app-logger';
import { getCurrentTraceContext } from '../observability/trace-context';
import type { AgentSessionSupervisor } from './agent-session-supervisor';

export const SESSION_SHUTDOWN_TIMEOUT_MS = 5_000;
const LOG_FLUSH_TIMEOUT_MS = 1_000;

export type FatalErrorKind = 'uncaughtException' | 'unhandledRejection';

export interface FatalErrorHandlerDependencies {
  logger: AppLogger;
  sessionSupervisor: Pick<AgentSessionSupervisor, 'cancelAllSessions' | 'countActiveSessions'>;
  crashDirectory: string;
  appVersion: string;
  exitProcess: (exitCode: number) => void;
  writeToTerminal: (text: string) => void;
  sessionShutdownTimeoutMs?: number;
}

/**
 * Process-level failure policy (CLAUDE.md): an error nothing handled means the process state is
 * unknown, so the server stops: fatal log with stack, crash report, cancel sessions (max 5 s),
 * flush logs, exit(1), tell the user how to restart. It never logs and carries on.
 */
export function installFatalErrorHandlers(dependencies: FatalErrorHandlerDependencies): () => void {
  let shuttingDown = false;
  const stopOnFatalError = (kind: FatalErrorKind) => (error: unknown) => {
    if (shuttingDown) {
      // A second failure while shutting down: stop now.
      dependencies.exitProcess(1);
      return;
    }
    shuttingDown = true;
    void shutDownAfterFatalError(kind, error, dependencies);
  };
  const onUncaughtException = stopOnFatalError('uncaughtException');
  const onUnhandledRejection = stopOnFatalError('unhandledRejection');
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);
  return () => {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  };
}

/** Never rejects; always ends with exitProcess(1). */
export async function shutDownAfterFatalError(
  kind: FatalErrorKind,
  error: unknown,
  dependencies: FatalErrorHandlerDependencies,
): Promise<void> {
  const occurredAt = new Date();
  const traceId = getCurrentTraceContext()?.traceId ?? null;
  const crashReportPath = path.join(
    dependencies.crashDirectory,
    `crash-${occurredAt.toISOString().replace(/[:.]/g, '-')}.json`,
  );
  try {
    dependencies.logger.fatal({ err: error, kind, traceId }, 'fatal error: aiteam is stopping');
    writeCrashReport(crashReportPath, {
      occurredAt: occurredAt.toISOString(),
      kind,
      traceId,
      error: describeError(error),
      pid: process.pid,
      appVersion: dependencies.appVersion,
      nodeVersion: process.version,
      activeSessions: dependencies.sessionSupervisor.countActiveSessions(),
    });
    const { unfinishedOwners } = await dependencies.sessionSupervisor.cancelAllSessions(
      dependencies.sessionShutdownTimeoutMs ?? SESSION_SHUTDOWN_TIMEOUT_MS,
    );
    if (unfinishedOwners.length > 0) {
      dependencies.logger.error({ unfinishedOwners }, 'sessions still running at fatal shutdown');
    }
    await flushLogs(dependencies.logger);
  } catch (shutdownError) {
    dependencies.writeToTerminal(`aiteam: lỗi khi dừng sau sự cố: ${String(shutdownError)}\n`);
  } finally {
    dependencies.writeToTerminal(
      [
        '',
        'AI Team gặp lỗi nghiêm trọng và đã dừng để bảo vệ dữ liệu.',
        `  Chi tiết: ${crashReportPath}`,
        '  Chạy lại: aiteam',
        '  Task đang chạy sẽ được đưa về hàng đợi khi khởi động lại.',
        '',
      ].join('\n'),
    );
    dependencies.exitProcess(1);
  }
}

function writeCrashReport(crashReportPath: string, report: Record<string, unknown>): void {
  mkdirSync(path.dirname(crashReportPath), { recursive: true, mode: 0o700 });
  writeFileSync(crashReportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      code: (error as { code?: unknown }).code ?? null,
    };
  }
  return { name: 'NonErrorThrown', message: String(error), stack: null, code: null };
}

function flushLogs(logger: AppLogger): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, LOG_FLUSH_TIMEOUT_MS);
    logger.flush(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
