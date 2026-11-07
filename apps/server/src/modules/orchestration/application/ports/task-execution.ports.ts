import type { AgentRole } from '@aiteam/contracts';
import type { EngineSnapshot } from '../../domain/entities/task';
import type { StaffMember } from '../../domain/step-assignee';
import type {
  AgentEnginePort,
  ApiConnectionCredentials,
  SessionPermissions,
} from './agent-engine.port';

// ---- Git workspace of a task -----------------------------------------------------------------

export const TASK_WORKSPACE = Symbol('TASK_WORKSPACE');

export interface PreparedTaskWorkspace {
  /** Root of the task's git worktree (branch agent/<taskId>). */
  worktreePath: string;
  /** Where the agent works: the chosen folder's place inside the worktree. */
  agentDirectory: string;
  /** QA documents copied into the worktree, relative to agentDirectory. */
  qaDocumentPaths: string[];
}

export interface SavedCheckpoint {
  sha: string;
  files: string[];
}

export interface TaskWorkspace {
  /**
   * Makes sure the task has its worktree: git init (and a first commit) when the folder is not
   * a repository yet, a folder under the data directory when none was chosen. Idempotent.
   */
  prepareTaskWorkspace(input: {
    taskId: string;
    workingDirectory: string | null;
    worktreePath: string | null;
    qaDocuments: ReadonlyArray<{ fileName: string; contentPath: string }>;
  }): Promise<PreparedTaskWorkspace>;
  /** Commits everything the agent changed ("mốc"); null when nothing changed. */
  saveCheckpoint(worktreePath: string, message: string): Promise<SavedCheckpoint | null>;
  /** Removes the worktree; the agent/<taskId> branch is always kept. */
  removeTaskWorkspace(worktreePath: string): Promise<void>;
}

// ---- Test command (gate "tests_pass") ------------------------------------------------------

export const TEST_COMMAND_RUNNER = Symbol('TEST_COMMAND_RUNNER');

export interface TestCommandResult {
  passed: boolean;
  exitCode: number | null;
  /** Last part of the output, handed to the agent when the tests fail. */
  outputTail: string;
}

export interface TestCommandRunner {
  /** Runs the user's test command in the agent's folder; never rejects for a failing test. */
  runTestCommand(
    command: string,
    directory: string,
    signal: AbortSignal,
  ): Promise<TestCommandResult>;
}

// ---- Engines --------------------------------------------------------------------------------

export const AGENT_RUN_PREPARER = Symbol('AGENT_RUN_PREPARER');

export interface PreparedAgentRun {
  engine: AgentEnginePort;
  model: string | null;
  permissions: SessionPermissions;
  apiConnection: ApiConnectionCredentials | null;
}

/** Turns an engine snapshot into what a session needs (engine, ceilings, decrypted API key). */
export interface AgentRunPreparer {
  prepareAgentRun(snapshot: EngineSnapshot): PreparedAgentRun;
}

// ---- Staff ----------------------------------------------------------------------------------

export const STAFF_DIRECTORY = Symbol('STAFF_DIRECTORY');

export interface StaffAgent extends StaffMember {
  name: string;
}

export interface StaffDirectory {
  listDepartmentStaff(departmentId: string): StaffAgent[];
  /** The agent's current engine configuration, as a snapshot to start a session with. */
  readEngineSnapshot(
    agentId: string,
  ): (EngineSnapshot & { name: string; role: AgentRole }) | undefined;
  /** Tasks each agent is busy with (running or waiting for approval). */
  countActiveTasksByAgent(departmentId: string): Map<string, number>;
}

// ---- Task events (the task log) ------------------------------------------------------------

export const TASK_EVENT_LOG = Symbol('TASK_EVENT_LOG');

export interface StepReportRecord {
  stepName: string;
  agentName: string;
  summary: string;
}

export interface TaskEventLog {
  recordTaskEvent(event: {
    taskId: string;
    agentId: string | null;
    kind: string;
    payload: Record<string, unknown>;
  }): void;
  /** Reports of finished turns, oldest first (the latest per step). */
  listStepReports(taskId: string): StepReportRecord[];
  /** Newest first. */
  listTaskEvents(taskId: string, limit: number): TaskEventRecord[];
}

export interface TaskEventRecord {
  id: number;
  kind: string;
  agentName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
