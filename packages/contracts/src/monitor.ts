import { z } from 'zod';
import { lineCommentStatusSchema, taskStatusSchema } from './enumerations';
import { entityIdSchema } from './organization';
import { TASK_BOARD_COLUMNS, taskAgentSchema } from './tasks';

// Live monitor: agent tiles, a task's files, checkpoints, diffs, line comments, review (phase 4).

export const WORKSPACE_PATH_MAX_LENGTH = 1_000;

/** A path relative to the task worktree, "/" separated, never absolute or with "..". */
export const workspacePathSchema = z
  .string()
  .min(1)
  .max(WORKSPACE_PATH_MAX_LENGTH)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !/^[a-zA-Z]:/.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    { message: 'Đường dẫn file không hợp lệ' },
  );

export const workspaceTreeSchema = z.object({
  /** Files relative to the worktree root, sorted. */
  files: z.array(z.string()),
  /** Folder of the task inside the worktree ("" when it is the root). */
  agentFolder: z.string(),
});
export type WorkspaceTree = z.infer<typeof workspaceTreeSchema>;

export const workspaceFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  binary: z.boolean(),
  truncated: z.boolean(),
  /** Agent-written text: always displayed as plain text. null for binary files. */
  content: z.string().nullable(),
});
export type WorkspaceFileContent = z.infer<typeof workspaceFileSchema>;

export const checkpointSchema = z.object({
  id: entityIdSchema,
  sha: z.string(),
  message: z.string(),
  files: z.array(z.string()),
  agentName: z.string().nullable(),
  stepName: z.string().nullable(),
  openCommentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const checkpointListSchema = z.array(checkpointSchema);

export const diffLineSchema = z.object({
  kind: z.enum(['context', 'add', 'delete']),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
  text: z.string(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const diffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  change: z.enum(['added', 'deleted', 'modified', 'renamed']),
  binary: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunks: z.array(z.object({ header: z.string(), lines: z.array(diffLineSchema) })),
  /** Very long diffs are cut; open the file to see everything. */
  truncated: z.boolean(),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

export const workspaceDiffSchema = z.object({
  /** The checkpoint shown, or null for "all changes since the task started". */
  checkpointId: entityIdSchema.nullable(),
  files: z.array(diffFileSchema),
});
export type WorkspaceDiff = z.infer<typeof workspaceDiffSchema>;

export const LINE_COMMENT_MAX_LENGTH = 2_000;

export const lineCommentSchema = z.object({
  id: entityIdSchema,
  checkpointId: entityIdSchema,
  filePath: z.string(),
  line: z.number().int().positive(),
  body: z.string(),
  status: lineCommentStatusSchema,
  createdAt: z.string(),
});
export type LineComment = z.infer<typeof lineCommentSchema>;
export const lineCommentListSchema = z.array(lineCommentSchema);

export const addLineCommentRequestSchema = z
  .object({
    filePath: workspacePathSchema,
    line: z.number().int().positive(),
    body: z.string().trim().min(1, 'Nhập góp ý').max(LINE_COMMENT_MAX_LENGTH),
  })
  .strict();
export type AddLineCommentRequest = z.infer<typeof addLineCommentRequestSchema>;

/** "Duyệt thay đổi" / "Yêu cầu sửa" on a checkpoint. */
export const submitCodeReviewRequestSchema = z
  .object({
    decision: z.enum(['approve', 'request_changes']),
    checkpointId: entityIdSchema,
    note: z.string().trim().max(LINE_COMMENT_MAX_LENGTH).default(''),
  })
  .strict();
export type SubmitCodeReviewRequest = z.infer<typeof submitCodeReviewRequestSchema>;

export const revertWorkspaceFileRequestSchema = z.object({ path: workspacePathSchema }).strict();
export type RevertWorkspaceFileRequest = z.infer<typeof revertWorkspaceFileRequestSchema>;

// ---- Agent tiles ----------------------------------------------------------------------------

export const AGENT_TILE_STATES = ['working', 'waiting', 'idle', 'off'] as const;
/** Inferred from the role, so the workspace opens on the most useful tab. */
export const WORK_TYPES = ['code', 'test', 'docs', 'design', 'plan', 'support'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const agentTileSchema = z.object({
  agent: taskAgentSchema,
  departmentId: entityIdSchema,
  state: z.enum(AGENT_TILE_STATES),
  workType: z.enum(WORK_TYPES),
  task: z
    .object({
      id: entityIdSchema,
      code: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      boardColumn: z.enum(TASK_BOARD_COLUMNS),
      stepName: z.string().nullable(),
      stepNumber: z.number().int().positive().nullable(),
      stepCount: z.number().int().nonnegative(),
      workingDirectory: z.string().nullable(),
    })
    .nullable(),
  lastActivity: z.object({ text: z.string(), at: z.string() }).nullable(),
});
export type AgentTile = z.infer<typeof agentTileSchema>;
export const agentTileListSchema = z.array(agentTileSchema);
