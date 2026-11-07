import { z } from 'zod';
import { WORKING_DIRECTORY_MAX_LENGTH } from './tasks';

// Local workspace settings: allowed folders and how many agents run at once (phase 3).

export const PARALLEL_AGENT_LIMITS = { min: 1, max: 8, default: 2 } as const;

export const workspaceSettingsSchema = z.object({
  /** Folders picked with the system folder dialog; tasks can only work inside them. */
  allowedDirectories: z.array(z.string()),
  maxParallelAgents: z.number().int().min(PARALLEL_AGENT_LIMITS.min).max(PARALLEL_AGENT_LIMITS.max),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

/** Folders can be removed here; adding one always goes through the folder dialog. */
export const updateWorkspaceSettingsRequestSchema = z
  .object({
    allowedDirectories: z.array(z.string().max(WORKING_DIRECTORY_MAX_LENGTH)).max(100).optional(),
    maxParallelAgents: z
      .number()
      .int()
      .min(PARALLEL_AGENT_LIMITS.min)
      .max(PARALLEL_AGENT_LIMITS.max)
      .optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.allowedDirectories !== undefined || request.maxParallelAgents !== undefined,
    { message: 'Cần ít nhất một trường để cập nhật' },
  );
export type UpdateWorkspaceSettingsRequest = z.infer<typeof updateWorkspaceSettingsRequestSchema>;

export const directoryValidationRequestSchema = z
  .object({ path: z.string().trim().min(1).max(WORKING_DIRECTORY_MAX_LENGTH) })
  .strict();
export type DirectoryValidationRequest = z.infer<typeof directoryValidationRequestSchema>;

export const directoryValidationSchema = z.object({
  /** Absolute, symlinks resolved, "~" expanded. */
  path: z.string(),
  exists: z.boolean(),
  allowed: z.boolean(),
  isGitRepository: z.boolean(),
  /** Why the folder cannot be used, or null when it can. */
  problem: z.string().nullable(),
});
export type DirectoryValidation = z.infer<typeof directoryValidationSchema>;

/** Result of the system folder dialog; null when the user cancelled. */
export const directoryPickSchema = z.object({ path: z.string().nullable() });
export type DirectoryPick = z.infer<typeof directoryPickSchema>;

export const recentDirectoryListSchema = z.array(z.string());
