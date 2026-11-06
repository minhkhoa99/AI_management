import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';
import { getCurrentTraceContext } from '../observability/trace-context';

export type AppLogger = Logger;

export const APP_LOGGER = Symbol('APP_LOGGER');

export interface AppLoggerOptions {
  level: LevelWithSilent;
  /** Absolute path of the JSON log file. When omitted, logs go to stdout. */
  logFilePath?: string;
  /** Explicit sink (tests). Takes precedence over logFilePath. */
  destinationStream?: DestinationStream;
}

/**
 * Creates the JSON logger. Every line automatically carries traceId/taskId/agentId from the
 * current AsyncLocalStorage trace context, so callers never pass them by hand.
 */
export function createAppLogger(options: AppLoggerOptions): AppLogger {
  const destination = options.destinationStream ?? openLogDestination(options.logFilePath);

  return pino(
    {
      level: options.level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      mixin: () => {
        const traceContext = getCurrentTraceContext();
        return traceContext === undefined ? {} : { ...traceContext };
      },
    },
    destination,
  );
}

function openLogDestination(logFilePath: string | undefined): DestinationStream {
  return logFilePath === undefined
    ? pino.destination({ dest: 1, sync: false })
    : pino.destination({ dest: logFilePath, mkdir: true, sync: false });
}
