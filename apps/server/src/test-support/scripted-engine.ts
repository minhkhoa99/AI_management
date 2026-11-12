import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEngineEvent } from '@aiteam/contracts';
import type {
  AgentEnginePort,
  AgentSessionRequest,
} from '../modules/orchestration/application/ports/agent-engine.port';

export type ScriptedResponse = (
  request: AgentSessionRequest,
  signal: AbortSignal,
) => Promise<string>;

/** The report block an agent ends its turn with. */
export function agentReport(
  outcome: string,
  summary: string,
  approvalRequest: string | null = null,
): string {
  return `Kết quả.\n<aiteam-report>${JSON.stringify({ outcome, summary, approvalRequest })}</aiteam-report>`;
}

function defaultOutcome(prompt: string): string {
  return prompt.includes('trả "pass" hoặc "fail"') || prompt.includes('cấp trên duyệt kết quả')
    ? 'pass'
    : 'done';
}

/** The step a prompt is about ("review" for a superior's review, "free" without workflow). */
export function stepNameOf(prompt: string): string {
  return (
    /bước \d+\/\d+ "([^"]+)"/.exec(prompt)?.[1] ??
    (prompt.includes('cấp trên duyệt') ? 'review' : 'free')
  );
}

/**
 * A fake engine for e2e tests: no CLI, no network. An editing agent writes turn-<n>.txt in its
 * folder (so every turn makes a checkpoint); `respond` decides the final answer.
 */
export class ScriptedEngine implements AgentEnginePort {
  readonly requests: AgentSessionRequest[] = [];
  respond: ScriptedResponse = (request) =>
    Promise.resolve(agentReport(defaultOutcome(request.prompt), 'xong'));

  async *startSession(
    request: AgentSessionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEngineEvent> {
    this.requests.push(request);
    yield { kind: 'session_started', sessionRef: `session-${this.requests.length}`, model: 'fake' };
    let answer: string;
    try {
      answer = await this.respond(request, signal);
    } catch {
      yield { kind: 'cancelled' };
      return;
    }
    if (signal.aborted) {
      yield { kind: 'cancelled' };
      return;
    }
    if (request.permissions.accessLevel === 'edit_workspace') {
      const fileName = `turn-${this.requests.length}.txt`;
      const filePath = path.join(request.workingDirectory, fileName);
      writeFileSync(filePath, `${answer}\n`);
      // Absolute, as Claude Code reports it.
      yield { kind: 'file_change', path: filePath, changeKind: 'add' };
    }
    yield { kind: 'message', text: 'đang làm' };
    yield { kind: 'completed', summary: answer };
  }
}

/** Polls until `accept` says yes (50 s at most: every turn commits through real git, slow under a parallel full-suite run). */
export async function waitFor<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 50_000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A promise that only ends (rejects) when the session is cancelled. */
export function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
}
