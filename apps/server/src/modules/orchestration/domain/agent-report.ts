import { z } from 'zod';

/**
 * Every agent turn ends with a machine-readable report, written by the agent itself:
 *
 *   <aiteam-report>{"outcome": "done", "summary": "…", "approvalRequest": null}</aiteam-report>
 *
 * Agent output is untrusted text: the report is parsed strictly and only steers the workflow
 * (pass / fail / ask the user); it never names files, commands or other agents.
 */
export const AGENT_REPORT_OUTCOMES = ['done', 'pass', 'fail', 'needs_approval'] as const;
export type AgentReportOutcome = (typeof AGENT_REPORT_OUTCOMES)[number];

const SUMMARY_MAX_LENGTH = 4_000;
const REPORT_PATTERN = /<aiteam-report>([\s\S]*?)<\/aiteam-report>/g;

const reportSchema = z.object({
  outcome: z.enum(AGENT_REPORT_OUTCOMES),
  summary: z.string().max(20_000).default(''),
  approvalRequest: z.string().max(4_000).nullable().default(null),
});

export interface AgentReport {
  outcome: AgentReportOutcome;
  summary: string;
  /** What the agent wants to do and why, when it stopped to ask the user. */
  approvalRequest: string | null;
  /** false: the agent did not end with a valid report; the whole answer is the summary. */
  wellFormed: boolean;
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
  };
}

function stripReports(text: string): string {
  return text.replace(REPORT_PATTERN, '').trim();
}

function clip(text: string): string {
  return text.length <= SUMMARY_MAX_LENGTH ? text : `${text.slice(0, SUMMARY_MAX_LENGTH)}…`;
}
