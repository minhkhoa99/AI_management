import { z } from 'zod';

// Single source of truth for every enumerated column. SQL CHECK constraints
// (apps/server/src/shared/database/migrations/002_constrain_enumerations.sql) must list exactly
// these values; enumerations.test.ts in the server inserts each one to catch drift.

/** How a department coordinates its agents. */
export const TEAM_MODES = ['orchestrator', 'claude_code_teams', 'codex_subagents'] as const;
export const teamModeSchema = z.enum(TEAM_MODES);
export type TeamMode = z.infer<typeof teamModeSchema>;

/** Which engine ("brain") an agent runs on. */
export const AGENT_PROVIDERS = ['claude_code', 'codex', 'custom_api'] as const;
export const agentProviderSchema = z.enum(AGENT_PROVIDERS);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

/** Fixed set of agent roles; workflow steps (owner_role) reference the same list. */
export const AGENT_ROLES = [
  'manager',
  'pm',
  'dev',
  'qc',
  'designer',
  'writer',
  'analyst',
  'support',
] as const;
export const agentRoleSchema = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof agentRoleSchema>;

/** What an agent may do in its workspace. */
export const ACCESS_LEVELS = ['read_only', 'edit_workspace'] as const;
export const accessLevelSchema = z.enum(ACCESS_LEVELS);
export type AccessLevel = z.infer<typeof accessLevelSchema>;

/** Wire format of a Custom API provider connection. */
export const API_FORMATS = ['openai', 'anthropic'] as const;
export const apiFormatSchema = z.enum(API_FORMATS);
export type ApiFormat = z.infer<typeof apiFormatSchema>;

/** Task priority stored as INTEGER: lower number = more urgent. */
export const TASK_PRIORITY = { high: 1, medium: 2, low: 3 } as const;
export const TASK_PRIORITIES = [
  TASK_PRIORITY.high,
  TASK_PRIORITY.medium,
  TASK_PRIORITY.low,
] as const;
export const taskPrioritySchema = z.literal(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** Task lifecycle: queued → running → waiting_* → succeeded | failed | cancelling → cancelled. */
export const TASK_STATUSES = [
  'queued',
  'running',
  'waiting_children',
  'waiting_approval',
  /** Stopped by the user; the scheduler leaves it alone until resumed. */
  'paused',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Statuses a task never leaves on its own. */
export const FINISHED_TASK_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly TaskStatus[];

/** Condition a workflow step must meet before the task moves to the next step. */
export const STEP_GATES = [
  'auto',
  'tests_pass',
  'qc_pass',
  'lead_approval',
  'user_approval',
] as const;
export const stepGateSchema = z.enum(STEP_GATES);
export type StepGate = z.infer<typeof stepGateSchema>;

/** What happens when a step's gate is not met. */
export const STEP_FAILURE_ACTIONS = ['retry', 'return_to_step', 'stop'] as const;
export const stepFailureActionSchema = z.enum(STEP_FAILURE_ACTIONS);
export type StepFailureAction = z.infer<typeof stepFailureActionSchema>;

/** Allowed max_retries when on_fail = 'retry'. */
export const STEP_RETRY_LIMITS = { min: 1, max: 5 } as const;

/**
 * Who owns a workflow step: an agent role of the department (the platform picks an enabled
 * agent with that role), or the user. A user-owned step is an approval step (gate user_approval).
 */
export const STEP_OWNERS = [...AGENT_ROLES, 'user'] as const;
export const stepOwnerSchema = z.enum(STEP_OWNERS);
export type StepOwner = z.infer<typeof stepOwnerSchema>;

/** Approval requests: a workflow step's gate, or work the agent paused for (sensitive action). */
export const APPROVAL_KINDS = ['step_gate', 'sensitive_action'] as const;
export const approvalKindSchema = z.enum(APPROVAL_KINDS);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** Why a task changed hands. */
export const DELEGATION_REASONS = ['manual', 'automatic', 'workflow_step'] as const;
export const delegationReasonSchema = z.enum(DELEGATION_REASONS);
export type DelegationReason = z.infer<typeof delegationReasonSchema>;

/** Line comments on a checkpoint: written, sent to the agent with "Yêu cầu sửa", resolved. */
export const LINE_COMMENT_STATUSES = ['open', 'sent', 'resolved'] as const;
export const lineCommentStatusSchema = z.enum(LINE_COMMENT_STATUSES);
export type LineCommentStatus = z.infer<typeof lineCommentStatusSchema>;

/**
 * Where a department skill came from: written in the app, added from a built-in template, an
 * uploaded SKILL.md or .zip, or imported from a GitHub folder.
 */
export const SKILL_SOURCE_KINDS = ['written', 'template', 'markdown', 'zip', 'github'] as const;
export const skillSourceKindSchema = z.enum(SKILL_SOURCE_KINDS);
export type SkillSourceKind = z.infer<typeof skillSourceKindSchema>;
