import { type EngineQuotaBucket, engineQuotaBucketSchema } from '@aiteam/contracts';
import { z } from 'zod';
import { AppError } from '../../../../../shared/errors/app-error';
import type {
  EngineQuotaReader,
  EngineQuotaReading,
} from '../../../application/ports/engine-quota-reader.port';
import { FLAG_SETTINGS } from '../engines/claude-code-cli.engine';
import { resolveCliExecutable } from '../engines/cli-process';
import { readQuotaCommandOutput } from './quota-command';
import { prepareQuotaProbeDirectory } from './quota-probe-directory';

const SIGNED_OUT_PATTERN = /authentication required|sign in|not logged in|unauthori[sz]ed|\b401\b/i;
const USAGE_LINE_PATTERN = /^(.+?):\s*(\d{1,3})% used(?:\s*·\s*resets\s+(.+))?$/;
const RESET_TIME_PATTERN =
  /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ONE_MINUTE_MS = 60_000;
const ALL_MODELS_LABEL = 'Tất cả model';

const usageOutputSchema = z.object({ result: z.string() });

/** Reads `claude -p "/usage"` (session and weekly limits) from a throw-away directory, no shell. */
export class CliClaudeQuotaReader implements EngineQuotaReader {
  readonly engine = 'claude_code' as const;

  constructor(private readonly dataDirectory: string) {}

  async readEngineQuota(): Promise<EngineQuotaReading> {
    try {
      const executable = resolveCliExecutable('claude');
      const probeDirectory = await prepareQuotaProbeDirectory(this.dataDirectory);
      const output = await readQuotaCommandOutput({
        executable,
        args: [
          '-p',
          '/usage',
          '--output-format',
          'json',
          '--setting-sources',
          '',
          '--settings',
          FLAG_SETTINGS,
          '--strict-mcp-config',
        ],
        workingDirectory: probeDirectory,
      });
      if (output.timedOut) return { state: 'unreadable', buckets: [] };
      const reading = parseClaudeUsage(output.stdout, new Date());
      if (
        reading.state === 'unreadable' &&
        SIGNED_OUT_PATTERN.test(`${output.stdout}\n${output.stderrTail}`)
      ) {
        return { state: 'not_signed_in', buckets: [] };
      }
      return reading;
    } catch (error) {
      const notInstalled = error instanceof AppError && error.code === 'ENGINE_NOT_INSTALLED';
      return { state: notInstalled ? 'not_installed' : 'unreadable', buckets: [] };
    }
  }
}

export function parseClaudeUsage(stdout: string, now: Date): EngineQuotaReading {
  const resultText = readResultText(stdout);
  if (resultText === undefined) return { state: 'unreadable', buckets: [] };
  const buckets: EngineQuotaBucket[] = [];
  for (const line of resultText.split(/\r?\n/)) {
    const match = USAGE_LINE_PATTERN.exec(line.trim());
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const description = describeLabel(match[1].trim());
    if (description === null) continue;
    const checked = engineQuotaBucketSchema.safeParse({
      ...description,
      remainingPercent: Math.min(100, Math.max(0, 100 - Number(match[2]))),
      resetsAt: match[3] === undefined ? null : parseClaudeResetTime(match[3].trim(), now),
    });
    if (!checked.success) return { state: 'unreadable', buckets: [] };
    buckets.push(checked.data);
  }
  if (buckets.length > 0) return { state: 'ok', buckets };
  if (/api key|console/i.test(resultText)) return { state: 'not_applicable', buckets: [] };
  if (/log ?in|sign in|authenticat/i.test(resultText)) {
    return { state: 'not_signed_in', buckets: [] };
  }
  return { state: 'unreadable', buckets: [] };
}

function readResultText(stdout: string): string | undefined {
  const lastLine = stdout
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('{'))
    .at(-1);
  if (lastLine === undefined) return undefined;
  try {
    const parsed = usageOutputSchema.safeParse(JSON.parse(lastLine));
    return parsed.success ? parsed.data.result : undefined;
  } catch {
    // Not JSON after all: the caller reports the output as unreadable.
    return undefined;
  }
}

type BucketDescription = Pick<
  EngineQuotaBucket,
  'group' | 'window' | 'windowLabel' | 'appliesToModels'
>;

function describeLabel(label: string): BucketDescription | null {
  if (label === 'Current session') {
    return { group: null, window: 'five_hour', windowLabel: '5 giờ', appliesToModels: null };
  }
  const week = /^Current week \((.+)\)$/.exec(label)?.[1]?.trim();
  if (week === undefined || week === '') return null;
  if (week.toLowerCase() === 'all models') {
    return {
      group: ALL_MODELS_LABEL,
      window: 'weekly',
      windowLabel: 'tuần',
      appliesToModels: null,
    };
  }
  return {
    group: week,
    window: 'weekly',
    windowLabel: 'tuần',
    appliesToModels: [week.toLowerCase()],
  };
}

/** "Nov 11, 11:59pm (Asia/Ho_Chi_Minh)" -> next such moment (UTC ISO) at or after now - 1 min. */
export function parseClaudeResetTime(text: string, now: Date): string | null {
  const match = RESET_TIME_PATTERN.exec(text.trim());
  if (match === null) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, timeZone] = match;
  const month = MONTHS.indexOf((monthName ?? '').toLowerCase());
  if (month < 0 || timeZone === undefined) return null;
  const hour12 = Number(hourText);
  if (hour12 < 1 || hour12 > 12) return null;
  const hour = (hour12 % 12) + (meridiem?.toLowerCase() === 'pm' ? 12 : 0);
  const earliest = now.getTime() - ONE_MINUTE_MS;
  try {
    for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const moment = zonedTimeToUtc(
        { year, month, day: Number(dayText), hour, minute: Number(minuteText ?? 0) },
        timeZone,
      );
      if (moment >= earliest) return new Date(moment).toISOString();
    }
  } catch {
    // Unknown IANA zone: the reset time is simply not known.
    return null;
  }
  return null;
}

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Local wall-clock time in an IANA zone -> UTC ms (offset measured twice to settle across DST). */
function zonedTimeToUtc(local: LocalTime, timeZone: string): number {
  const asUtc = Date.UTC(local.year, local.month, local.day, local.hour, local.minute);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const offsetAt = (instant: number): number => {
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(instant))) {
      parts[part.type] = Number(part.value);
    }
    const shown = Date.UTC(
      parts.year ?? 0,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
    );
    return shown - Math.floor(instant / ONE_MINUTE_MS) * ONE_MINUTE_MS;
  };
  const firstGuess = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(firstGuess);
}
