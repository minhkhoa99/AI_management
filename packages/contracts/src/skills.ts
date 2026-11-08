import { z } from 'zod';
import { skillSourceKindSchema } from './enumerations';
import { entityIdSchema } from './organization';

// ---- Limits ---------------------------------------------------------------------------------

export const SKILL_NAME_MAX_LENGTH = 80;
export const SKILL_DESCRIPTION_MAX_LENGTH = 500;
/** SKILL.md instructions (the part after the front matter). */
export const SKILL_CONTENT_MAX_LENGTH = 40_000;
/** Uploaded .md / .zip, and the archive downloaded from GitHub. */
export const SKILL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Every file of one skill once extracted. */
export const SKILL_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const SKILL_MAX_FILES = 300;
export const SKILL_UPLOAD_EXTENSIONS = ['.md', '.zip'] as const;
export const SKILL_ASSIGNMENT_MAX = 50;

// ---- Read models ----------------------------------------------------------------------------

export const departmentSkillSchema = z.object({
  id: entityIdSchema,
  departmentId: entityIdSchema,
  name: z.string(),
  /** When the agent should use it; shown to agents in their prompt. */
  description: z.string(),
  sourceKind: skillSourceKindSchema,
  /** GitHub URL it was imported from; null for other sources. */
  sourceUrl: z.string().nullable(),
  fileCount: z.number().int().positive(),
  totalBytes: z.number().int().nonnegative(),
  /** Agents of the department that may use it. */
  assignedAgentIds: z.array(entityIdSchema),
  updatedAt: z.string(),
});
export type DepartmentSkill = z.infer<typeof departmentSkillSchema>;
export const departmentSkillListSchema = z.array(departmentSkillSchema);

export const skillDetailSchema = departmentSkillSchema.extend({
  /** SKILL.md instructions without the front matter. */
  content: z.string(),
  /** Every file of the skill, "/" separated, SKILL.md first. */
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative() })),
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;

export const skillTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type SkillTemplate = z.infer<typeof skillTemplateSchema>;
export const skillTemplateListSchema = z.array(skillTemplateSchema);

// ---- Requests -------------------------------------------------------------------------------

const skillNameSchema = z.string().trim().min(1, 'Nhập tên skill').max(SKILL_NAME_MAX_LENGTH);
const skillDescriptionSchema = z.string().trim().max(SKILL_DESCRIPTION_MAX_LENGTH);
const skillContentSchema = z.string().max(SKILL_CONTENT_MAX_LENGTH);

export const createWrittenSkillRequestSchema = z
  .object({
    name: skillNameSchema,
    description: skillDescriptionSchema.default(''),
    content: skillContentSchema.default(''),
  })
  .strict();
export type CreateWrittenSkillRequest = z.infer<typeof createWrittenSkillRequestSchema>;

export const addTemplateSkillRequestSchema = z
  .object({ templateId: z.string().min(1).max(64) })
  .strict();
export type AddTemplateSkillRequest = z.infer<typeof addTemplateSkillRequestSchema>;

/**
 * A GitHub repository or folder: https://github.com/<owner>/<repo>[/tree/<ref>/<folder>], or a
 * SKILL.md file (…/blob/<ref>/<path>.md). Only github.com is fetched.
 */
export const importGithubSkillRequestSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (url) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/(tree|blob)\/[^\s?#]+)?\/?$/.test(url),
        {
          message: 'Dán link GitHub dạng https://github.com/<chủ>/<repo>[/tree/<nhánh>/<thư mục>]',
        },
      ),
  })
  .strict();
export type ImportGithubSkillRequest = z.infer<typeof importGithubSkillRequestSchema>;

/** `PUT /api/departments/:id/skills/upload?fileName=…` with the raw file as the body. */
export const skillUploadFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((name) => !/[\\/:*?"<>|]/.test(name), { message: 'Tên file không hợp lệ' })
  .refine(
    (name) =>
      (SKILL_UPLOAD_EXTENSIONS as readonly string[]).some((extension) =>
        name.toLowerCase().endsWith(extension),
      ),
    { message: `Chỉ nhận ${SKILL_UPLOAD_EXTENSIONS.join(', ')}` },
  );

export const updateSkillRequestSchema = z
  .object({
    name: skillNameSchema.optional(),
    description: skillDescriptionSchema.optional(),
    content: skillContentSchema.optional(),
  })
  .strict();
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

export const copySkillRequestSchema = z.object({ targetDepartmentId: entityIdSchema }).strict();
export type CopySkillRequest = z.infer<typeof copySkillRequestSchema>;

/** Replaces the agent's skills; every skill must belong to the agent's department. */
export const setAgentSkillsRequestSchema = z
  .object({ skillIds: z.array(entityIdSchema).max(SKILL_ASSIGNMENT_MAX) })
  .strict();
export type SetAgentSkillsRequest = z.infer<typeof setAgentSkillsRequestSchema>;
