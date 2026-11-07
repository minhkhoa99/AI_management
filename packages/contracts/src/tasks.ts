import { z } from 'zod';
import {
  agentProviderSchema,
  agentRoleSchema,
  approvalKindSchema,
  approvalStatusSchema,
  delegationReasonSchema,
  stepGateSchema,
  taskPrioritySchema,
  taskStatusSchema,
  type StepGate,
  type TaskStatus,
} from './enumerations';
import { entityIdSchema } from './organization';

// Request and response contracts for tasks (phase 3).

export const TASK_TITLE_MAX_LENGTH = 120;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;
export const TASK_CRITERIA_MAX_LENGTH = 5_000;
export const TASK_TEST_COMMAND_MAX_LENGTH = 500;
export const TASK_PREVIEW_COMMAND_MAX_LENGTH = 500;
/** Replaced by a free port when the preview starts. */
export const PREVIEW_PORT_PLACEHOLDER = '{port}';
export const WORKING_DIRECTORY_MAX_LENGTH = 1_000;

// ---- QA documents ---------------------------------------------------------------------------

export const QA_DOCUMENT_EXTENSIONS = [
  '.md',
  '.txt',
  '.feature',
  '.csv',
  '.pdf',
  '.docx',
  '.xlsx',
] as const;
/** Text formats whose test cases the platform counts; the others are read by the agent. */
export const QA_COUNTABLE_EXTENSIONS = ['.md', '.txt', '.feature', '.csv'] as const;
export const QA_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const QA_DOCUMENTS_PER_TASK_MAX = 10;
export const QA_DOCUMENT_NAME_MAX_LENGTH = 200;

export function readFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex <= 0 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isCountableQaDocument(fileName: string): boolean {
  return (QA_COUNTABLE_EXTENSIONS as readonly string[]).includes(readFileExtension(fileName));
}

/** A bare file name with an accepted extension (no folders, no control characters). */
export const qaDocumentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(QA_DOCUMENT_NAME_MAX_LENGTH)
  .refine(
    (name) =>
      !/[\\/:*?"<>|]/.test(name) &&
      ![...name].some((character) => character.charCodeAt(0) < 0x20) &&
      name !== '.' &&
      name !== '..',
    { message: 'Tên file không hợp lệ' },
  )
  .refine(
    (name) => (QA_DOCUMENT_EXTENSIONS as readonly string[]).includes(readFileExtension(name)),
    { message: `Chỉ nhận ${QA_DOCUMENT_EXTENSIONS.join(', ')}` },
  );

/**
 * Test cases in a text QA document: Gherkin scenarios, CSV rows (minus the header), or
 * checklist items / "TC-01" lines / "## Test …" headings in Markdown and plain text.
 */
export function countQaTestCases(text: string, fileName: string): number {
  const lines = text.split(/\r?\n/);
  const extension = readFileExtension(fileName);
  if (extension === '.feature') {
    return lines.filter((line) => /^\s*(Scenario Outline|Scenario|Kịch bản)\s*:/i.test(line))
      .length;
  }
  if (extension === '.csv') {
    return Math.max(0, lines.filter((line) => line.trim() !== '').length - 1);
  }
  return lines.filter((line) =>
    /^\s*([-*]\s*\[[ xX]\]|TC[-_ ]?\d+|#{2,4}\s*(TC|Test|Case|Kịch bản))/i.test(line),
  ).length;
}

export const taskAttachmentSchema = z.object({
  id: entityIdSchema,
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  /** null: not a countable text format, the agent reads it when it takes the task. */
  detectedCases: z.number().int().nonnegative().nullable(),
});
export type TaskAttachment = z.infer<typeof taskAttachmentSchema>;

// ---- Completion goal -----------------------------------------------------------------------

export const COMPLETION_GOAL_SOURCES = ['qa', 'description', 'none'] as const;

export const completionGoalSchema = z.object({
  source: z.enum(COMPLETION_GOAL_SOURCES),
  title: z.string(),
  summary: z.string(),
  note: z.string(),
  items: z.array(z.string()),
});
export type CompletionGoal = z.infer<typeof completionGoalSchema>;

export function splitCriteria(criteria: string): string[] {
  return criteria
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * What "done" means for a task: the QA documents when there are any, otherwise the
 * description and criteria. Shared by the task form (live preview) and the server (prompt).
 */
export function buildCompletionGoal(input: {
  description: string;
  criteria: string;
  qaDocuments: ReadonlyArray<{ fileName: string; detectedCases: number | null }>;
}): CompletionGoal {
  const criteria = splitCriteria(input.criteria);
  const description = input.description.trim();
  if (input.qaDocuments.length > 0) {
    const caseCount = input.qaDocuments.reduce(
      (total, document) => total + (document.detectedCases ?? 0),
      0,
    );
    const casesText = caseCount > 0 ? `, ${caseCount} kịch bản` : '';
    return {
      source: 'qa',
      title: 'Đích hoàn thành: theo tài liệu QA',
      summary: `đọc ${input.qaDocuments.length} tài liệu QA${caseCount > 0 ? ` (${caseCount} kịch bản)` : ''} làm đích`,
      note: `AI đọc ${input.qaDocuments.length} file QA${casesText} làm đích, QC kiểm tra theo đúng các kịch bản này. Mô tả và tiêu chí dùng để bổ sung bối cảnh.`,
      items: input.qaDocuments.map(
        (document) =>
          document.fileName +
          (document.detectedCases ? ` – ${document.detectedCases} kịch bản` : ''),
      ),
    };
  }
  if (criteria.length > 0 || description !== '') {
    return {
      source: 'description',
      title: 'Đích hoàn thành: theo mô tả và tiêu chí',
      summary: `không có QA, dùng ${criteria.length > 0 ? `${criteria.length} tiêu chí hoàn thành` : 'mô tả task'} làm đích`,
      note: `Không có tài liệu QA. AI dùng Mô tả${criteria.length > 0 ? ` và ${criteria.length} tiêu chí hoàn thành` : ''} làm đích, QC tự sinh kịch bản kiểm thử từ đó.`,
      items: criteria.length > 0 ? criteria : [description],
    };
  }
  return {
    source: 'none',
    title: 'Chưa có đích hoàn thành',
    summary: 'chưa có đích hoàn thành',
    note: 'Tải tài liệu QA lên, hoặc viết Mô tả và Tiêu chí hoàn thành để AI biết khi nào là xong.',
    items: [],
  };
}

// ---- Board ----------------------------------------------------------------------------------

/** Kanban columns: "Cần làm", "Đang làm", "QC đang kiểm", "Hoàn thành". */
export const TASK_BOARD_COLUMNS = ['todo', 'in_progress', 'qc', 'done'] as const;
export type TaskBoardColumn = (typeof TASK_BOARD_COLUMNS)[number];

export function resolveTaskBoardColumn(
  status: TaskStatus,
  currentStepGate: StepGate | null,
): TaskBoardColumn {
  switch (status) {
    case 'queued':
      return 'todo';
    case 'succeeded':
    case 'cancelled':
      return 'done';
    default:
      return currentStepGate === 'qc_pass' ? 'qc' : 'in_progress';
  }
}

// ---- Tasks ----------------------------------------------------------------------------------

export const taskAgentSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  role: agentRoleSchema,
  provider: agentProviderSchema,
  /** Agent and its department are both switched on. */
  available: z.boolean(),
});
export type TaskAgent = z.infer<typeof taskAgentSchema>;

export const taskSummarySchema = z.object({
  id: entityIdSchema,
  /** Short human reference, e.g. "T-142". */
  code: z.string(),
  departmentId: entityIdSchema,
  title: z.string(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  boardColumn: z.enum(TASK_BOARD_COLUMNS),
  assignee: taskAgentSchema.nullable(),
  workflow: z.object({ id: entityIdSchema, name: z.string() }).nullable(),
  currentStep: z.object({ id: entityIdSchema, name: z.string(), gate: stepGateSchema }).nullable(),
  workingDirectory: z.string().nullable(),
  /** Why the task waits, is retried or failed; null when there is nothing to say. */
  statusNote: z.string().nullable(),
  attachmentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export const taskSummaryListSchema = z.array(taskSummarySchema);

export const taskDetailSchema = taskSummarySchema.extend({
  description: z.string(),
  criteria: z.string(),
  testCommand: z.string().nullable(),
  /** Starts the app's dev server for the preview tab; contains {port}. */
  previewCommand: z.string().nullable(),
  attachments: z.array(taskAttachmentSchema),
  /** Reporting line from the department head down to the assignee. */
  assigneeChain: z.array(taskAgentSchema),
  completionGoal: completionGoalSchema,
  delegations: z.array(
    z.object({
      fromAgentName: z.string().nullable(),
      toAgentName: z.string().nullable(),
      reason: delegationReasonSchema,
      createdAt: z.string(),
    }),
  ),
  /** Direct subordinates of the assignee the task can be handed to (available ones). */
  delegationTargets: z.array(taskAgentSchema),
  pendingApprovalId: entityIdSchema.nullable(),
  /** Steps of the task's workflow, to show where it is. */
  workflowSteps: z.array(z.object({ id: entityIdSchema, name: z.string(), gate: stepGateSchema })),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

const taskTitleSchema = z.string().trim().min(1, 'Nhập tiêu đề task').max(TASK_TITLE_MAX_LENGTH);
const taskDescriptionSchema = z.string().trim().max(TASK_DESCRIPTION_MAX_LENGTH);
const taskCriteriaSchema = z.string().trim().max(TASK_CRITERIA_MAX_LENGTH);
/** Run by the platform in the task worktree for the "tests must pass" gate; trusted user input. */
const testCommandSchema = z.string().trim().max(TASK_TEST_COMMAND_MAX_LENGTH);
/** Starts the dev server for the preview tab; trusted user input, must contain {port}. */
const previewCommandSchema = z
  .string()
  .trim()
  .max(TASK_PREVIEW_COMMAND_MAX_LENGTH)
  .refine((command) => command === '' || command.includes(PREVIEW_PORT_PLACEHOLDER), {
    message: 'Lệnh chạy giao diện phải có {port} (vd. npm run dev -- --port {port})',
  });
const workingDirectoryInputSchema = z.string().trim().max(WORKING_DIRECTORY_MAX_LENGTH);

export const createTaskRequestSchema = z
  .object({
    departmentId: entityIdSchema,
    title: taskTitleSchema,
    description: taskDescriptionSchema.default(''),
    criteria: taskCriteriaSchema.default(''),
    priority: taskPrioritySchema,
    /** Defaults to the department head. */
    assigneeAgentId: entityIdSchema.optional(),
    /** Omitted: the department's default workflow. null: no workflow. */
    workflowId: entityIdSchema.nullable().optional(),
    /** Empty: the platform creates a folder for the task. */
    workingDirectory: workingDirectoryInputSchema.default(''),
    testCommand: testCommandSchema.default(''),
    previewCommand: previewCommandSchema.default(''),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    criteria: taskCriteriaSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeAgentId: entityIdSchema.optional(),
    workflowId: entityIdSchema.nullable().optional(),
    workingDirectory: workingDirectoryInputSchema.optional(),
    testCommand: testCommandSchema.optional(),
    previewCommand: previewCommandSchema.optional(),
  })
  .strict()
  .refine((request) => Object.values(request).some((value) => value !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const taskListQuerySchema = z
  .object({ departmentId: entityIdSchema.optional(), workflowId: entityIdSchema.optional() })
  .strict();
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/** DELETE /api/tasks/:id answers 202: deleted now, or cancelling while the agent stops. */
export const taskDeletionSchema = z.object({
  taskId: entityIdSchema,
  outcome: z.enum(['deleted', 'cancelling']),
});
export type TaskDeletion = z.infer<typeof taskDeletionSchema>;

// ---- Execution: delegation, stage moves, events, approvals ------------------------------------

export const delegateTaskRequestSchema = z.object({ toAgentId: entityIdSchema }).strict();
export type DelegateTaskRequest = z.infer<typeof delegateTaskRequestSchema>;

/** Kanban arrows: one step back, or one step forward when the workflow allows skipping. */
export const moveTaskStageRequestSchema = z
  .object({ direction: z.enum(['back', 'forward']) })
  .strict();
export type MoveTaskStageRequest = z.infer<typeof moveTaskStageRequestSchema>;

export const TASK_EVENT_LIST_MAX = 200;

export const taskEventSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  agentName: z.string().nullable(),
  /** One line for the task log; the full payload stays on the server. */
  text: z.string(),
  /** Longer plain text when there is one: a command's output, a full agent message. */
  detail: z.string().nullable(),
  /** The file a file_change event is about (the monitor reloads it when it is open). */
  filePath: z.string().nullable(),
  createdAt: z.string(),
});
export type TaskEvent = z.infer<typeof taskEventSchema>;
export const taskEventListSchema = z.array(taskEventSchema);

export const approvalSchema = z.object({
  id: entityIdSchema,
  kind: approvalKindSchema,
  status: approvalStatusSchema,
  task: z.object({
    id: entityIdSchema,
    code: z.string(),
    title: z.string(),
    departmentId: entityIdSchema,
  }),
  summary: z.string(),
  /** What the agent asks to do, or the step result to approve. Agent text: show as plain text. */
  request: z.string(),
  stepName: z.string().nullable(),
  agentName: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;
export const approvalListSchema = z.array(approvalSchema);

export const approvalListQuerySchema = z
  .object({ status: approvalStatusSchema.optional() })
  .strict();

export const decideApprovalRequestSchema = z
  .object({ approved: z.boolean(), note: z.string().trim().max(2_000).default('') })
  .strict();
export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;
