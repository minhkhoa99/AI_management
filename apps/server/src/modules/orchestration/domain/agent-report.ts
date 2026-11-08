import { TASK_TITLE_MAX_LENGTH } from '@aiteam/contracts';
import { z } from 'zod';

/**
 * Every agent turn ends with a machine-readable report, written by the agent itself:
 *
 *   <aiteam-report>{"outcome": "done", "summary": "…", "approvalRequest": null}</aiteam-report>
 *
 * Agent output is untrusted text: the report is parsed strictly and only steers the workflow
 * (pass / fail / ask the user / split into subtasks); it never names files or commands. A
 * subtask's assignee is only a name matched against the agent's real subordinates.
 */
export const AGENT_REPORT_OUTCOMES = ['done', 'pass', 'fail', 'needs_approval'] as const;
export type AgentReportOutcome = (typeof AGENT_REPORT_OUTCOMES)[number];

const SUMMARY_MAX_LENGTH = 4_000;
const REPORT_PATTERN = /<aiteam-report>([\s\S]*?)<\/aiteam-report>/g;

/** At most this many subtasks per split; extra ones are dropped. */
export const MAX_SUBTASKS_PER_SPLIT = 5;
const SUBTASK_DESCRIPTION_MAX_LENGTH = 4_000;

const reportSchema = z.object({
  outcome: z.enum(AGENT_REPORT_OUTCOMES),
  summary: z.string().max(20_000).default(''),
  approvalRequest: z.string().max(4_000).nullable().default(null),
  /** Checked item by item below: one bad subtask must not void the whole report. */
  subtasks: z.array(z.unknown()).max(50).default([]),
});

const subtaskRequestSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().trim().max(SUBTASK_DESCRIPTION_MAX_LENGTH).default(''),
  /** Name of one of the agent's direct subordinates; anything else is ignored. */
  assignee: z.string().trim().max(200).nullable().default(null),
});

/** A piece of the step the agent asks a subordinate to do. */
export type SubtaskRequest = z.infer<typeof subtaskRequestSchema>;

export interface AgentReport {
  outcome: AgentReportOutcome;
  summary: string;
  /** What the agent wants to do and why, when it stopped to ask the user. */
  approvalRequest: string | null;
  /** false: the agent did not end with a valid report; the whole answer is the summary. */
  wellFormed: boolean;
  /** Valid subtasks the agent asked for (at most MAX_SUBTASKS_PER_SPLIT); usually empty. */
  subtasks: SubtaskRequest[];
}

export function interpretAgentReport(finalText: string | null): AgentReport {
  const text = finalText ?? '';
  const blocks = [...text.matchAll(REPORT_PATTERN)];
  const lastBlock = blocks.at(-1)?.[1];
  if (lastBlock !== undefined) {
    try {
      const parsed = reportSchema.safeParse(JSON.parse(lastBlock.trim()));
      if (parsed.success) {
        return {
          outcome: parsed.data.outcome,
          summary: clip(parsed.data.summary.trim() || stripReports(text)),
          approvalRequest:
            parsed.data.outcome === 'needs_approval'
              ? clip(parsed.data.approvalRequest?.trim() || parsed.data.summary.trim())
              : null,
          wellFormed: true,
          subtasks: parsed.data.subtasks
            .map((candidate) => subtaskRequestSchema.safeParse(candidate))
            .flatMap((result) => (result.success ? [result.data] : []))
            .slice(0, MAX_SUBTASKS_PER_SPLIT),
        };
      }
    } catch {
      // Not JSON: handled below like a missing report (the text is kept as the summary).
    }
  }
  return {
    outcome: 'done',
    summary: clip(stripReports(text)),
    approvalRequest: null,
    wellFormed: false,
    subtasks: [],
  };
}

function stripReports(text: string): string {
  return text.replace(REPORT_PATTERN, '').trim();
}

function clip(text: string): string {
  return text.length <= SUMMARY_MAX_LENGTH ? text : `${text.slice(0, SUMMARY_MAX_LENGTH)}…`;
}
