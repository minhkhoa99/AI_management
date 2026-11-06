import { z } from 'zod';
import {
  agentProviderSchema,
  agentRoleSchema,
  accessLevelSchema,
  teamModeSchema,
} from './enumerations';

// Request and response contracts for departments, agents and the org chart (phase 1).
// Request schemas are strict: unknown keys are rejected rather than ignored.

export const DEPARTMENT_NAME_MAX_LENGTH = 60;
export const AGENT_NAME_MAX_LENGTH = 60;
export const MODEL_NAME_MAX_LENGTH = 100;
export const BULK_TOGGLE_MAX_AGENTS = 500;

export const entityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Mã không hợp lệ');

export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Màu phải có dạng #RRGGBB');

const departmentNameSchema = z
  .string()
  .trim()
  .min(1, 'Nhập tên phòng ban')
  .max(DEPARTMENT_NAME_MAX_LENGTH);
const agentNameSchema = z.string().trim().min(1, 'Nhập tên thành viên').max(AGENT_NAME_MAX_LENGTH);

// ---- Departments ---------------------------------------------------------------------------

export const departmentSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  color: hexColorSchema,
  enabled: z.boolean(),
  teamMode: teamModeSchema,
  agentCount: z.number().int().nonnegative(),
});
export type Department = z.infer<typeof departmentSchema>;
export const departmentListSchema = z.array(departmentSchema);

export const memberPreviewSchema = z.object({
  agentId: entityIdSchema,
  name: z.string(),
  provider: agentProviderSchema,
  enabled: z.boolean(),
});
export type MemberPreview = z.infer<typeof memberPreviewSchema>;

/** Department card on the overview screen. */
export const departmentSummarySchema = departmentSchema.extend({
  headAgentName: z.string().nullable(),
  memberPreview: z.array(memberPreviewSchema),
});
export type DepartmentSummary = z.infer<typeof departmentSummarySchema>;
export const departmentSummaryListSchema = z.array(departmentSummarySchema);

export const createDepartmentRequestSchema = z
  .object({ name: departmentNameSchema, color: hexColorSchema })
  .strict();
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z
  .object({ name: departmentNameSchema.optional(), color: hexColorSchema.optional() })
  .strict()
  .refine((request) => request.name !== undefined || request.color !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;

export const setEnabledRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type SetEnabledRequest = z.infer<typeof setEnabledRequestSchema>;

// ---- Agents --------------------------------------------------------------------------------

export const agentDepartmentRefSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  color: hexColorSchema,
  enabled: z.boolean(),
});

/** One row of the agent table and one block of the org chart. */
export const agentSummarySchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  role: agentRoleSchema,
  provider: agentProviderSchema,
  model: z.string().nullable(),
  enabled: z.boolean(),
  positionId: entityIdSchema,
  reportsToPositionId: entityIdSchema.nullable(),
  department: agentDepartmentRefSchema,
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export const agentListSchema = z.array(agentSummarySchema);

export const agentDetailSchema = agentSummarySchema.extend({
  connectionId: entityIdSchema.nullable(),
  accessLevel: accessLevelSchema,
  networkAccess: z.boolean(),
  reportsToAgentName: z.string().nullable(),
  subordinateCount: z.number().int().nonnegative(),
});
export type AgentDetail = z.infer<typeof agentDetailSchema>;

export const AGENT_SEARCH_MAX_LENGTH = 100;

export const agentListQuerySchema = z
  .object({
    departmentId: entityIdSchema.optional(),
    q: z.string().max(AGENT_SEARCH_MAX_LENGTH).optional(),
  })
  .strict();
export type AgentListQuery = z.infer<typeof agentListQuerySchema>;

export const bulkSetAgentsEnabledRequestSchema = z
  .object({
    agentIds: z
      .array(entityIdSchema)
      .min(1)
      .max(BULK_TOGGLE_MAX_AGENTS)
      .refine((agentIds) => new Set(agentIds).size === agentIds.length, {
        message: 'Danh sách agent bị trùng',
      }),
    enabled: z.boolean(),
  })
  .strict();
export type BulkSetAgentsEnabledRequest = z.infer<typeof bulkSetAgentsEnabledRequestSchema>;

export const bulkSetAgentsEnabledResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});

// ---- Members (seat + agent) and org chart ---------------------------------------------------

export const addDepartmentMemberRequestSchema = z
  .object({
    name: agentNameSchema,
    role: agentRoleSchema,
    provider: agentProviderSchema,
    connectionId: entityIdSchema.optional(),
    model: z.string().trim().min(1).max(MODEL_NAME_MAX_LENGTH).optional(),
    /** null only for the first member, who becomes the head of the department. */
    reportsToPositionId: entityIdSchema.nullable(),
  })
  .strict();
export type AddDepartmentMemberRequest = z.infer<typeof addDepartmentMemberRequestSchema>;

export const updateDepartmentMemberRequestSchema = z
  .object({ name: agentNameSchema.optional(), role: agentRoleSchema.optional() })
  .strict()
  .refine((request) => request.name !== undefined || request.role !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateDepartmentMemberRequest = z.infer<typeof updateDepartmentMemberRequestSchema>;

export const changeReportingLineRequestSchema = z
  .object({ reportsToPositionId: entityIdSchema })
  .strict();
export type ChangeReportingLineRequest = z.infer<typeof changeReportingLineRequestSchema>;

export interface OrgTreeNode {
  positionId: string;
  agent: AgentSummary;
  children: OrgTreeNode[];
}

export const orgTreeNodeSchema: z.ZodType<OrgTreeNode> = z.object({
  positionId: entityIdSchema,
  agent: agentSummarySchema,
  get children() {
    return z.array(orgTreeNodeSchema);
  },
});

export const orgTreeSchema = z.object({
  department: departmentSchema,
  /** The head of the department; null while the department has no members. */
  root: orgTreeNodeSchema.nullable(),
});
export type OrgTree = z.infer<typeof orgTreeSchema>;
