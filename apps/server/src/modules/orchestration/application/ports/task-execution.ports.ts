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
export const AGENT_SKILL_SOURCE = Symbol('AGENT_SKILL_SOURCE');

/** A skill the agent may use: copied into the worktree under .aiteam-skills/<slug>/. */
export interface AgentSkillFolder {
  skillId: string;
  name: string;
  description: string;
  slug: string;
  /** The platform's copy of the skill (SKILL.md at its root). */
  folder: string;
}

/** Skills assigned to an agent in its department (skills module). */
export interface AgentSkillSource {
  listAgentSkillFolders(agentId: string): AgentSkillFolder[];
  /** SKILL.md text, for agents that cannot open files (Custom API). */
  readSkillManifest(skillId: string): string;
}

export interface PreparedTaskWorkspace {
  /** Root of the task's git worktree (branch agent/<taskId>). */
  worktreePath: string;
  /** Where the agent works: the chosen folder's place inside the worktree. */
  agentDirectory: string;
  /** QA documents copied into the worktree, relative to agentDirectory. */
  qaDocumentPaths: string[];
  /** SKILL.md of each skill copied for the agent, relative to agentDirectory, by slug. */
  skillManifestPaths: Map<string, string>;
  /** HEAD when the worktree was created now; null when it already existed. */
  baseSha: string | null;
}

export interface WorkspaceFile {
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  /** null for binary files. */
  content: string | null;
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
    /** A subtask: its branch starts from the parent's branch (latest checkpoint), same folder. */
    forkFromTaskId?: string | null;
    /** The agent's skills; .aiteam-skills/ is rebuilt with exactly these on every turn. */
    skills?: ReadonlyArray<{ slug: string; folder: string }>;
  }): Promise<PreparedTaskWorkspace>;
  /**
   * Merges a finished subtask's branch into the parent's worktree (a platform commit). On a
   * conflict the merge is undone and nothing changes; the subtask branch is always kept.
   */
  mergeSubtaskBranch(
    parentWorktreePath: string,
    subtaskId: string,
    message: string,
  ): Promise<'merged' | 'conflict'>;
  /** Commits everything the agent changed ("mốc"); null when nothing changed. */
  saveCheckpoint(worktreePath: string, message: string): Promise<SavedCheckpoint | null>;
  /**
   * New (untracked) paths under engine-managed folder names that checkpoints leave out, at most
   * the first 20, relative, "/" separated. Empty when there are none.
   */
  listUncommittedEngineManagedPaths(worktreePath: string): Promise<string[]>;
  /** Removes the worktree; the agent/<taskId> branch is always kept. */
  removeTaskWorkspace(worktreePath: string): Promise<void>;
  /** Folder of the task inside the repository ("" for the root), "/" separated. */
  locateAgentFolder(workingDirectory: string | null): Promise<string>;
  /** Files of the worktree (tracked and new, .gitignore respected), relative, "/" separated. */
  listWorkspaceFiles(worktreePath: string): Promise<string[]>;
  /** `relativePath` must stay inside the worktree (symlinks resolved); refused otherwise. */
  readWorkspaceFile(worktreePath: string, relativePath: string): Promise<WorkspaceFile>;
  /** Unified patch of one commit. */
  readCommitPatch(worktreePath: string, sha: string): Promise<string>;
  /** Unified patch between two commits (fromSha null: the repository's first commit). */
  readRangePatch(worktreePath: string, fromSha: string | null, toSha: string): Promise<string>;
  /** Puts a file back as it was at `baseSha` (deletes it when it did not exist then). */
  revertWorkspaceFile(
    worktreePath: string,
    baseSha: string | null,
    relativePath: string,
  ): Promise<void>;
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
  hasTask(taskId: string): boolean;
  /** Writes buffered events now (reads of aggregates call it first). */
  flushPendingEvents(): void;
}

export interface TaskEventRecord {
  id: number;
  kind: string;
  agentName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
