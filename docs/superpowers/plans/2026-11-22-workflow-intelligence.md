# Quy trình AI, bàn giao giữa phòng, đồ thị tri thức — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI soạn/tối ưu quy trình và nhập/xuất JSON; bước quy trình bàn giao cho phòng khác rồi nhận kết quả về; mỗi lượt agent nhận bản đồ code và bài học của dự án.

**Architecture:** Phần 1 thêm cổng `ONE_SHOT_AGENT_RUNNER` (providers hiện thực qua `EngineTestRunRegistry`, chỉ đọc, thư mục tạm) và các hàm thuần dựng prompt/đọc đề xuất trong orchestration; đề xuất chỉ đổ vào editor, lưu bằng route có sẵn. Phần 2 thêm chủ bước `department` (migration 015), task bàn giao là task con khác phòng tái dùng `parent_task_id`/`waiting_children`/`ResumeSplitTasksUseCase`. Phần 3 là module `knowledge` mới (migration 016) đọc cây code từ object git, thu bài học qua `applyGateResult`, đưa tri thức vào prompt và `.aiteam-knowledge/` qua cổng `TASK_KNOWLEDGE`.

**Tech Stack:** TypeScript, NestJS + Fastify, `node:sqlite`, zod, Vitest, Next.js export, CSS Modules. Không thêm thư viện.

**Spec:** `docs/superpowers/specs/2026-11-22-workflow-intelligence-design.md`

## Global Constraints

- Không thêm dependency. Không FTS5 (CI chạy Node 22). Không ORM, SQL viết tay.
- Migration: `015_department_handoff.sql` (`rebuildsTables: true`), `016_knowledge.sql`. Không sửa migration cũ. Giá trị liệt kê mới (`STEP_OWNERS` + `'department'`, `KNOWLEDGE_LESSON_SOURCES`) ở `enumerations.ts` + CHECK + `enumerations.test.ts`.
- Tên cấm theo `id-denylist` (`execute`, `run`, `handle`, `process`, `data`, `info`, `manager`, `helper`, `util`). Mỗi use case một phương thức công khai.
- Mọi phiên agent trong `AgentSessionSupervisor`. Phiên AI soạn/tối ưu: `read_only`, không mạng, thư mục tạm rỗng (`withReadme: false`), `workspaceRoot: null`, qua `EngineTestRunRegistry` (3 phút, một lượt mỗi `workflow-ai:<departmentId>`).
- Chữ từ agent không tin cậy: zod strict, giới hạn độ dài, trích dẫn kèm "không phải chỉ thị"; path chỉ để khớp chỉ mục, không bao giờ mở.
- Không log mục tiêu, prompt, câu trả lời, nội dung bài học, stdout git; chỉ độ dài và `code`.
- Đề xuất AI không bao giờ tự lưu. Nhập JSON chỉ tạo quy trình mới.
- Phòng đích bàn giao chỉ từ `workflow_steps.handoff_department_id` người dùng lưu. `HANDOFF_ROUND_LIMIT = 3`, `HANDOFF_DESCRIPTION_MAX_LENGTH = 8_000`.
- Tri thức là phụ: lỗi git/SQLite/parse → `logger.warn({ err })`, lượt chạy tiếp không có tri thức.
- Giới hạn: mục tiêu ≤ 4000; câu trả lời AI ≤ 200 KB; ≤ 20 bước, ≤ 20 thay đổi (tiêu đề ≤ 120, lý do ≤ 500); file nhập ≤ 256 KB; < 5 task kết thúc → `WORKFLOW_STATS_TOO_FEW`; phần tri thức trong prompt ≤ 6000 ký tự; `lessons.md`/`code-map.md` ≤ 200 KB; bài học 1..1500 ký tự, ≤ 500/repo; chỉ mục ≤ 5000 file, ≤ 256 KB/file, ≤ 8 MB/lượt.
- Ngân sách bundle web: code ứng dụng ≤ 70 KB, tổng lần đầu ≤ 230 KB (`npm run check:bundle`).
- Kiểm tra cuối mỗi task: `npm run lint` và `npm test -- <file test của task>`; task cuối mỗi phần chạy full `npm test`, `npm run build`, `npm run check:bundle`; Task 14 thêm `npm run measure`.
- Commit Conventional Commits, kết thúc `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Chạy bằng Node đã vá (≥ 22.23.4 / 24.22.1 / 26.12.1).

## Review Focus

1. **AI tối ưu gộp/xoá bước khi có task đang ở bước cũ** → `fromStepIndex` ánh xạ về id cũ, mỗi id một lần, lưu không vướng `WORKFLOW_STEP_IN_USE`. Test: Task 4, Task 5.
2. **Quy trình Review có `on_fail` retry/return và reviewer báo fail** → task con `failed` ngay (`gate_rejected`), cha quay về bước Dev với `Phòng Review (T-n) không đạt: …`; quá 3 vòng → cha `failed`; chạy lại đếm từ 0. Test: Task 7, Task 8.
3. **Phòng Review lỗi engine, task con bị huỷ/xoá** → cha `failed` "lỗi kỹ thuật", Dev không làm lại. Test: Task 8.
4. **Git lỗi khi đọc cây code, hoặc agent thay `.aiteam-knowledge` bằng junction** → lượt vẫn chạy, junction bị xoá, không ghi ra ngoài worktree, thư mục không vào mốc. Test: Task 11, Task 13.
5. **Góp ý không đạt nhắc `src/a.ts` (kể cả task ở thư mục con)** → bài học gắn path theo gốc repo, lượt sau có trong prompt; test fail không sinh bài học. Test: Task 12, Task 14.

---

### Task 1: Số liệu theo bước: `stepId` trong sự kiện và `summarizeWorkflowRuns`

**Files:**

- Modify: `apps/server/src/modules/orchestration/application/use-cases/task-progression.ts`
- Modify: `apps/server/src/modules/orchestration/application/use-cases/start-task-turn.use-case.ts` (payload `turn_started`)
- Modify: `apps/server/src/modules/orchestration/application/use-cases/finish-task-turn.use-case.ts` (payload `engine_failed` trong `applyEngineFailure`)
- Create: `apps/server/src/modules/orchestration/domain/workflow-run-stats.ts`
- Test: `apps/server/src/modules/orchestration/application/use-cases/task-progression.test.ts` (mới), `apps/server/src/modules/orchestration/domain/workflow-run-stats.test.ts`

**Interfaces:**

- Produces:
  - `private recordOutcome(task: Task, kind: string, detail: string | null, stepId: string | null)` → payload `{ detail, stepId }`. Mọi lời gọi truyền `state.currentStepId`, tức `state` đã chụp ở đầu `applyGateResult` **trước** `requeue`. Như vậy `stepId` là bước vừa chấm, không phải bước kế. Gồm cả `task_succeeded`. Chạy tự do thì `stepId` là `null`.
  - `turn_started` payload thêm `stepId: step?.id ?? null`. `engine_failed` payload thêm `stepId: state.currentStepId`.
  - `interface WorkflowRunEvent { taskId: string; kind: string; payload: Record<string, unknown>; createdAt: string }`
  - `interface WorkflowStepRunStats { stepId: string; turns: number; passed: number; retried: number; returned: number; stopped: number; engineFailures: number; gatePassRate: number | null; medianTurnMs: number | null; recentFeedback: string[] }`
  - `summarizeWorkflowRuns(steps: readonly { id: string }[], events: readonly WorkflowRunEvent[]): WorkflowStepRunStats[]`. Kết quả theo thứ tự `steps`. `events` đã xếp theo task, cũ trước.

Gán bước cho sự kiện, đi lần lượt trong từng task:

- payload có khoá `stepId`: dùng giá trị đó; `null` = không thuộc bước nào.
- `step_report`: dùng `stepKey`.
- Ngoài hai trường hợp trên: dùng bước của sự kiện gần nhất trước nó trong cùng task. Đây là đường cho sự kiện cũ.
- `stepId` không còn trong `steps` thì bỏ qua.

Cách đếm:

- `turns` = số `step_report`. `passed` = `step_passed` + `task_succeeded`. `retried` = `step_retried`. `returned` = `step_returned`. `stopped` = `task_failed`. `engineFailures` = `engine_failed`.
- `gatePassRate` = passed / (passed + retried + returned + stopped), mẫu 0 thì `null`.
- `medianTurnMs`: ghép `turn_started` với `step_report` kế tiếp trong cùng task. Số chẵn thì lấy trung bình hai số giữa, làm tròn. Không có cặp nào thì `null`.
- `recentFeedback`: tối đa 3 `detail` (chuỗi khác rỗng) mới nhất của `step_retried|step_returned|task_failed`, mỗi mục cắt 300 ký tự.

- [ ] **Step 1: Test hỏng**

```ts
// task-progression.test.ts: Workflow.restore (2–3 bước, DEFAULT_WORKFLOW_RULES), repo giả { findWorkflowById: () => workflow },
// eventLog { recordTaskEvent: vi.fn() }, Task.createNew({... workflowId: 'wf-1'}) rồi task.startTurn(stepId, SNAPSHOT)
it('records the evaluated step on step_passed although the task moved to the next step', () => {
  progression.applyGateResult(taskOn('build'), true, null);
  expect(eventLog.recordTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'step_passed', payload: { detail: 'Sang bước "test".', stepId: 'build' } }));
});
it('records stepId on step_returned, task_failed (stop) and task_succeeded (last step)', ...);
// payload { detail: 'Thiếu test', stepId: 'test' } cho return_to_step; { detail: null, stepId: 'approve' } cho bước cuối

// workflow-run-stats.test.ts
it('counts outcomes per step by stepId', ...);           // build: turns 2, passed 1, retried 1, gatePassRate 0.5
it('attributes old events without stepId to the latest step_report', ...); // step_passed {detail} sau step_report{stepKey:'build'}
it('does not attribute an event whose stepId is null', ...);
it('takes the median turn time from turn_started to step_report', ...);   // 60 s, 180 s, 120 s → 120_000; 60 s, 120 s → 90_000
it('reports a step without turns without dividing by zero', ...);       // bước user: turns 0, gatePassRate null, medianTurnMs null
it('keeps the 3 newest feedback lines, 300 chars each', ...);
```

- [ ] **Step 2: Chạy** `npm test -- task-progression workflow-run-stats` → FAIL.
- [ ] **Step 3: Hiện thực** theo Interfaces. Không đổi `describe-task-event.ts` (khoá thêm vào payload không ảnh hưởng).
- [ ] **Step 4: Chạy lại** → PASS. `npm test -- task-execution.e2e tracing.e2e` vẫn PASS. `npm run lint` sạch.
- [ ] **Step 5: Commit** `feat(orchestration): record step id on outcome events and summarize workflow runs`

---

### Task 2: Contracts quy trình AI và nhập/xuất JSON

**Files:**

- Modify: `packages/contracts/src/workflows.ts`
- Modify: `apps/server/src/modules/orchestration/application/use-cases/create-workflow.use-case.ts`
- Test: `packages/contracts/src/workflows.test.ts` (mới), `apps/server/src/modules/orchestration/workflows.e2e.test.ts`

**Interfaces:**

- Produces (`workflows.ts`):
  - `WORKFLOW_GOAL_MAX_LENGTH = 4000`; `draftWorkflowStepsRequestSchema = z.object({ goal: z.string().trim().min(1, 'Nhập mục tiêu cho quy trình').max(4000), agentId: entityIdSchema.optional() }).strict()`; `proposeWorkflowOptimizationRequestSchema = z.object({ agentId: entityIdSchema.optional() }).strict()`. Kèm type.
  - `workflowProposalStepSchema = workflowStepDraftSchema.extend({ fromStepIndex: z.number().int().min(0).nullable() })`
  - `workflowProposalSchema = z.object({ steps: z.array(workflowProposalStepSchema).min(1).max(WORKFLOW_MAX_STEPS), changes: z.array(z.object({ title: z.string().trim().min(1).max(120), reason: z.string().trim().max(500) }).strict()).max(20), warnings: z.array(z.string()), basedOnTaskCount: z.number().int().nonnegative() })`, type `WorkflowProposal`.
  - `workflowExportDocumentSchema = z.object({ format: z.literal('aiteam-workflow'), version: z.literal(1), name: workflowNameSchema, description: workflowDescriptionSchema, enforce: z.boolean(), rules: workflowRulesSchema, steps: z.array(workflowStepDraftSchema.omit({ id: true })).min(1).max(WORKFLOW_MAX_STEPS) }).strict()`, type `WorkflowExportDocument`.
  - `buildWorkflowExportDocument(workflow: Workflow): WorkflowExportDocument`: `returnToStepId` đổi thành chỉ số, giống `copyStepBlueprints`.
  - `workflowSourceSchema` thêm `z.object({ kind: z.literal('import'), document: workflowExportDocumentSchema }).strict()`.
- `CreateWorkflowUseCase`:
  - `resolveStartingSteps` thêm `case 'import': return source.document.steps;`.
  - Trong cùng transaction, khi `source.kind === 'import'` thì gọi `created.changeRules({ enforce: document.enforce, rules: document.rules })` trước `insertWorkflow`.
  - Tên và mô tả lấy từ request (web điền sẵn từ file).

- [ ] **Step 1: Test hỏng**

```ts
// workflows.test.ts
it('exports a workflow without ids, return targets as indexes', () => {
  const document = buildWorkflowExportDocument(workflowWith3StepsWhereStep2ReturnsToStep0);
  expect(document).toMatchObject({ format: 'aiteam-workflow', version: 1 });
  expect(document.steps[2]).not.toHaveProperty('id');
  expect(document.steps[2]?.returnToStepIndex).toBe(0);
  expect(workflowExportDocumentSchema.safeParse(document).success).toBe(true);
});
it('rejects another format, version 2 and unknown fields', ...);
it('limits the AI goal to 4000 characters and proposals to 20 steps', ...);

// workflows.e2e.test.ts
it('imports an exported workflow as an identical new one', async () => {
  // tạo từ template 'software', PATCH rules { enforce: false, rules: { allowAgentSubsteps: true } }
  const imported = await createWorkflow({ name: 'Bản nhập', source: { kind: 'import', document: buildWorkflowExportDocument(original) } });
  expect(buildWorkflowExportDocument(imported)).toEqual({ ...buildWorkflowExportDocument(original), name: 'Bản nhập' });
});
it('refuses an import document with an unknown field (400)', ...);
```

- [ ] **Step 2: Chạy** `npm test -- packages/contracts/src/workflows.test.ts workflows.e2e` → FAIL.
- [ ] **Step 3: Hiện thực.**
- [ ] **Step 4: Chạy lại** → PASS. Lint sạch.
- [ ] **Step 5: Commit** `feat(workflows): proposal contracts and JSON import/export`

---

### Task 3: Gọi LLM một lần: `AskAgentOnceUseCase` trong providers

**Files:**

- Modify: `apps/server/src/modules/orchestration/application/ports/task-execution.ports.ts`
- Modify: `apps/server/src/modules/providers/application/ports/sample-workspace.port.ts`, `apps/server/src/modules/providers/infrastructure/adapters/temporary-sample-workspace.factory.ts`
- Modify: `apps/server/src/modules/providers/application/engine-test-run-registry.ts` (chỉ câu báo xung đột)
- Create: `apps/server/src/modules/providers/application/use-cases/ask-agent-once.use-case.ts`
- Modify: `apps/server/src/modules/providers/providers.module.ts`
- Test: `apps/server/src/modules/providers/application/use-cases/ask-agent-once.use-case.test.ts`

**Interfaces:**

- Produces:
  - `export const ONE_SHOT_AGENT_RUNNER = Symbol('ONE_SHOT_AGENT_RUNNER'); export interface OneShotAgentRunner { askAgentOnce(request: { snapshot: EngineSnapshot; prompt: string; runKey: string }): Promise<string> }`
  - `createSampleWorkspace(options?: { withReadme: boolean }): SampleWorkspace`. Mặc định `true`, nên hai use case chạy thử không đổi.
  - Câu báo xung đột của registry: `'Đang có một lượt chạy cho mục này. Chờ xong hoặc huỷ trước.'`. Mã giữ `TEST_RUN_IN_PROGRESS` (409).
  - `class AskAgentOnceUseCase implements OneShotAgentRunner`. Constructor: `@Inject(AGENT_RUN_PREPARER) runPreparer: AgentRunPreparer`, `@Inject(SAMPLE_WORKSPACE_FACTORY) workspaceFactory`, `testRunRegistry: EngineTestRunRegistry`.
  - Module: `{ provide: ONE_SHOT_AGENT_RUNNER, useClass: AskAgentOnceUseCase }`, thêm vào `exports`.

Các bước của `askAgentOnce`:

1. Gọi `prepareAgentRun({ ...snapshot, accessLevel: 'read_only', networkAccess: false })`.
2. Gọi `createSampleWorkspace({ withReadme: false })`.
3. Gọi `startEngineTestRun(runKey, signal => engine.startSession({ prompt, workingDirectory: workspace.directory, workspaceRoot: null, model, permissions, resumeSessionRef: null, apiConnection }, signal), () => workspace.disposeSampleWorkspace())`. Nếu start ném lỗi thì dispose rồi ném lại, giống `StartLocalEngineTestRunUseCase`.
4. Gọi `followEngineTestRun`, giữ `message` cuối và sự kiện kết thúc. Resolve ở `onFinish`.

Ánh xạ sự kiện kết thúc:

| Sự kiện                    | Kết quả                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `completed`                | `summary ?? lastMessage ?? ''`                                                              |
| `failed` mã `RATE_LIMITED` | `RateLimitedError(message, 0)`                                                              |
| `failed` retryable khác    | `EngineUnavailableError(message)`                                                           |
| `failed` không retryable   | `EngineAuthError(message, { code: event.code })`                                            |
| `cancelled` (hết 3 phút)   | `EngineUnavailableError('AI không trả lời trong 3 phút.', { code: 'AI_PROPOSAL_TIMEOUT' })` |

Không log prompt hay câu trả lời. Không chờ hạn mức.

- [ ] **Step 1: Test hỏng.** Dùng `EngineTestRunRegistry` thật + `AgentSessionSupervisor` như `engine-test-run-registry.test.ts`, preparer giả trả engine giả, factory giả ghi lại tham số.

```ts
it('runs read-only and offline in an empty throw-away folder and returns the final summary', async () => {
  await expect(runner.askAgentOnce({ snapshot: EDITING_ONLINE_SNAPSHOT, prompt: 'p', runKey: 'workflow-ai:d1' })).resolves.toBe('kết quả');
  expect(preparer.prepareAgentRun).toHaveBeenCalledWith(expect.objectContaining({ accessLevel: 'read_only', networkAccess: false }));
  expect(factory.createSampleWorkspace).toHaveBeenCalledWith({ withReadme: false });
  expect(engineRequests[0]).toMatchObject({ workingDirectory: '/tmp/sample', workspaceRoot: null, resumeSessionRef: null });
  expect(dispose).toHaveBeenCalledTimes(1);
});
it('falls back to the last message when the summary is null', ...);
it.each([
  [{ kind: 'failed', code: 'RATE_LIMITED', message: 'm', retryable: true }, 'RATE_LIMITED'],
  [{ kind: 'failed', code: 'ENGINE_UNAVAILABLE', message: 'm', retryable: true }, 'ENGINE_UNAVAILABLE'],
  [{ kind: 'failed', code: 'ENGINE_AUTH_FAILED', message: 'm', retryable: false }, 'ENGINE_AUTH_FAILED'],
  [{ kind: 'cancelled' }, 'AI_PROPOSAL_TIMEOUT'],
])('maps %o to %s', ...);
it('refuses a second run with the same key and disposes its folder', ...); // code TEST_RUN_IN_PROGRESS
```

- [ ] **Step 2: Chạy** `npm test -- ask-agent-once engine-test-run-registry` → FAIL.
- [ ] **Step 3: Hiện thực.**
- [ ] **Step 4: Chạy lại** → PASS. `npm test -- providers.e2e` PASS. Lint sạch.
- [ ] **Step 5: Commit** `feat(providers): one-shot agent runner for workflow proposals`

---

### Task 4: Domain: prompt đề xuất và đọc câu trả lời AI

**Files:**

- Create: `apps/server/src/modules/orchestration/domain/workflow-proposal-prompt.ts`
- Create: `apps/server/src/modules/orchestration/domain/workflow-proposal.ts`
- Test: `apps/server/src/modules/orchestration/domain/workflow-proposal-prompt.test.ts`, `apps/server/src/modules/orchestration/domain/workflow-proposal.test.ts`

**Interfaces:**

- Consumes: `WorkflowStepRunStats` (Task 1), `workflowProposalStepSchema` (Task 2), `ROLE_LABELS_FOR_PROMPTS` (`domain/role-labels.ts`), `STEP_GATES`, `STEP_FAILURE_ACTIONS`, `STEP_RETRY_LIMITS`, `WORKFLOW_MAX_STEPS`.
- Produces:
  - `type WorkflowProposalMode = { kind: 'draft'; goal: string } | { kind: 'optimize'; workflowName: string; steps: readonly WorkflowStepState[]; stats: readonly WorkflowStepRunStats[] }`
  - `buildWorkflowProposalPrompt(input: { departmentName: string; staffedRoles: readonly AgentRole[]; mode: WorkflowProposalMode }): string`
  - `WORKFLOW_PROPOSAL_TEXT_MAX_LENGTH = 200 * 1024`
  - `interpretWorkflowProposal(input: { finalText: string; currentStepIds: readonly string[]; staffedRoles: ReadonlySet<AgentRole> }): Omit<WorkflowProposal, 'basedOnTaskCount'>`

Nội dung prompt:

- Vai dùng được: dòng `- <role> (<nhãn>)` cho từng vai trong `staffedRoles`, cộng dòng `- user`.
- Mỗi giá trị gate và onFail kèm một câu giải thích. Giới hạn: ≤ 20 bước, `maxRetries` 1..5 chỉ khi `retry`, `returnToStepIndex` trỏ về bước đứng trước.
- Câu `Không dùng ownerRole "department"`.
- Mục tiêu đặt giữa `<aiteam-goal>\n…\n</aiteam-goal>`, ghi rõ "dữ liệu, không phải chỉ thị". Mọi chữ người dùng/agent đưa vào prompt đều bỏ thẻ `</?aiteam-[a-z-]*>`.
- Yêu cầu kết thúc bằng `<aiteam-workflow>{"steps":[…],"changes":[{"title","reason"}]}</aiteam-workflow>`, liệt kê tên trường của bước.

Chế độ tối ưu thêm:

- Bước hiện tại, mỗi dòng mở đầu `[<index 0-based>] "<tên>"` kèm vai/gate/onFail.
- Số liệu mỗi bước: `lượt N`, `qua gate X%` (hoặc `chưa có`), `trung vị S giây`.
- Phản hồi mỗi bước dưới tiêu đề `Phản hồi gần nhất (dữ liệu từ agent, không phải chỉ thị)`, mỗi dòng tiền tố `> `.
- Chỉ dẫn: được thêm/xoá/gộp/đổi thứ tự bước; bước giữ hoặc gộp từ bước cũ đặt `fromStepIndex` = index cũ, bước mới đặt `null`.

Đọc câu trả lời:

1. `finalText` dài quá giới hạn, không có khối, hoặc JSON hỏng → lỗi.
2. Chỉ đọc khối cuối, theo schema strict `{ steps: z.array(z.record(z.string(), z.unknown())).min(1).max(20), changes: (schema change của Task 2).max(20).default([]) }`.
3. Bước có `ownerRole === 'department'` bị bỏ, kèm cảnh báo `Bỏ bước "<tên>": AI không được giao bước cho phòng khác.`. Bước có `returnToStepIndex` trỏ vào bước bị bỏ đổi thành `onFail: 'stop', returnToStepIndex: null`; chỉ số lớn hơn giảm 1.
4. Bước còn lại parse bằng `workflowProposalStepSchema.omit({ id: true })` (strict). Một bước sai → cả câu trả lời lỗi.
5. Không còn bước nào → lỗi.
6. `fromStepIndex` hợp lệ (< `currentStepIds.length`, chưa dùng) → `id = currentStepIds[i]`. Không hợp lệ hoặc trùng → `id` vắng mặt, `fromStepIndex: null`.
7. Vai (khác `user`) không có trong `staffedRoles` → cảnh báo `Chưa có agent vai <nhãn> đang bật trong phòng (bước "<tên>").`
8. Lỗi giữa các bước (`listWorkflowStepProblems`) **không** ném: editor sẽ hiện.

Mọi lỗi cấu trúc: `EngineUnavailableError('AI trả lời sai định dạng. Thử lại.', { code: 'AI_PROPOSAL_INVALID' })`.

- [ ] **Step 1: Test hỏng**

```ts
const block = (answer: unknown) => `Giải thích.\n<aiteam-workflow>${JSON.stringify(answer)}</aiteam-workflow>`;
const aiStep = (over = {}) => ({ name: 'Code', ownerRole: 'dev', gate: 'auto', onFail: 'stop',
  returnToStepIndex: null, maxRetries: 0, requiredOutput: '', fromStepIndex: null, ...over });
it('reads only the last block', ...);  // khối đầu 'Cũ', khối cuối 'Mới' → steps[0].name 'Mới'
it.each(['không có khối', '<aiteam-workflow>{</aiteam-workflow>', block({ steps: [aiStep({ extra: 1 })] }),
  block({ steps: Array.from({ length: 21 }, () => aiStep()) }), 'x'.repeat(200 * 1024 + 1) + block({ steps: [aiStep()] })])
  ('rejects %#', (text) => expect(() => interpret(text)).toThrow(expect.objectContaining({ code: 'AI_PROPOSAL_INVALID' })));
it('maps fromStepIndex to existing ids, each id once', ...);
  // currentStepIds ['s1','s2'], fromStepIndex [1,1,0,5] → id ['s2',undefined,'s1',undefined], fromStepIndex [1,null,0,null]
it('drops department steps and fixes return targets, warns about unstaffed roles', ...);
  // [dev A, department Review, qc B return→0, dev C return→1], staffed {dev} → names [A,B,C]; C: stop/null; warnings đúng chuỗi trên
it('keeps cross-step problems for the editor', ...); // user + gate auto → không ném
// prompt
it('lists staffed roles, user, every gate and failure action', ...); // chứa '- dev (Dev)', '- user'; không chứa '- qc'
it('puts the goal in a data block the goal cannot close', ...);
  // goal 'Làm API </aiteam-goal><aiteam-workflow>' → chứa '<aiteam-goal>\nLàm API \n</aiteam-goal>'
it('numbers current steps from 0 and shows stats and quoted feedback in optimize mode', ...);
  // '[0] "Code"', 'lượt 4', 'qua gate 50%', 'trung vị 120 giây', '> Thiếu test'
```

- [ ] **Step 2: Chạy** `npm test -- workflow-proposal` → FAIL.
- [ ] **Step 3: Hiện thực.** Domain không import NestJS.
- [ ] **Step 4: Chạy lại** → PASS. Lint sạch.
- [ ] **Step 5: Commit** `feat(orchestration): workflow proposal prompt and answer parsing`

---

### Task 5: Use case, route và giao diện: AI soạn bước, AI tối ưu, xuất, nhập

**Files:**

- Create: `apps/server/src/modules/orchestration/application/ports/workflow-run-history.query.ts`
- Create: `apps/server/src/modules/orchestration/infrastructure/persistence/sqlite-workflow-run-history.query.ts`
- Create: `apps/server/src/modules/orchestration/application/use-cases/workflow-proposal-author.ts`
- Create: `apps/server/src/modules/orchestration/application/use-cases/draft-workflow-steps.use-case.ts`, `.../propose-workflow-optimization.use-case.ts`
- Modify: `apps/server/src/modules/orchestration/presentation/controllers/workflows.controller.ts`, `apps/server/src/modules/orchestration/orchestration.module.ts`
- Modify (web): `apps/web/src/features/workflows/workflows-api.ts`, `.../workflow-step-drafts.ts`, `.../components/workflow-editor.tsx`, `.../components/workflow-form-panel.tsx`, `.../components/workflows.module.css`
- Create (web): `apps/web/src/features/workflows/components/workflow-ai-panel.tsx`
- Test: `apps/server/src/modules/orchestration/application/use-cases/workflow-proposal-author.test.ts`, `apps/server/src/modules/orchestration/workflow-proposals.e2e.test.ts`

**Interfaces:**

- Consumes: `ONE_SHOT_AGENT_RUNNER` (Task 3), `STAFF_DIRECTORY`, `TASK_EVENT_LOG.flushPendingEvents()`, `requireDepartment` (`departments/application/use-cases/department-lookup`), `requireWorkflow`, Task 1 và Task 4.
- Produces:
  - Query port:
    - `WORKFLOW_RUN_HISTORY_QUERY`
    - `interface WorkflowRunHistory { finishedTaskCount: number; events: WorkflowRunEvent[] }`
    - `interface WorkflowRunHistoryQuery { listWorkflowRunHistory(workflowId: string): WorkflowRunHistory }`
  - Hiện thực SQLite:
    - Lấy 100 task gần nhất của quy trình có `status IN ('succeeded','failed','cancelled')`, xếp `created_at DESC, rowid DESC`.
    - Lấy sự kiện `kind IN ('turn_started','step_report','step_passed','step_retried','step_returned','task_succeeded','task_failed','engine_failed')` của các task đó, `ORDER BY task_id, id`, `JSON.parse(payload_json)`.
  - `WorkflowProposalAuthor.writeWorkflowProposal(input: { departmentId: string; departmentName: string; agentId: string | undefined; mode: WorkflowProposalMode }): Promise<Omit<WorkflowProposal, 'basedOnTaskCount'>>`. Constructor: `STAFF_DIRECTORY`, `ONE_SHOT_AGENT_RUNNER`, `APP_LOGGER`. Các bước:
    1. Chọn agent:
       - Có `agentId` thì agent phải nằm trong `listDepartmentStaff(departmentId)` và `available`, nếu không → `ValidationError('Agent phải thuộc phòng và đang bật.', { code: 'WORKFLOW_AI_AGENT_INVALID' })`.
       - Không có `agentId` thì lấy trưởng phòng (`reportsToPositionId === null`) nếu `available`, không thì agent `available` đầu tiên.
       - Không có ai → `ValidationError(..., { code: 'DEPARTMENT_HAS_NO_AVAILABLE_AGENT' })`.
    2. `staffedRoles` = vai của staff `available`.
    3. Đọc `readEngineSnapshot`, chỉ giữ các trường `EngineSnapshot`, ép `accessLevel: 'read_only', networkAccess: false`.
    4. Gọi `askAgentOnce` với `runKey: \`workflow-ai:${departmentId}\``.
    5. Gọi `interpretWorkflowProposal` với `currentStepIds` = id các bước của `mode` (bản soạn thì `[]`).
    6. Log `{ departmentId, agentId, mode: kind, answerLength }`, không log mục tiêu hay câu trả lời.
  - `DraftWorkflowStepsUseCase.draftWorkflowSteps(departmentId: string, request: DraftWorkflowStepsRequest): Promise<WorkflowProposal>`. `requireDepartment`, `basedOnTaskCount: 0`.
  - `ProposeWorkflowOptimizationUseCase.proposeWorkflowOptimization(workflowId: string, request: ProposeWorkflowOptimizationRequest): Promise<WorkflowProposal>`:
    1. `requireWorkflow`, rồi `flushPendingEvents()`.
    2. `finishedTaskCount < 5` → `ValidationError('Cần ít nhất 5 task đã kết thúc theo quy trình này để AI tối ưu.', { code: 'WORKFLOW_STATS_TOO_FEW' })`, ném trước khi gọi runner.
    3. Gọi `summarizeWorkflowRuns`; `basedOnTaskCount = finishedTaskCount`.
  - Route có `@HttpCode(200)`: `POST api/departments/:departmentId/workflow-drafts` và `POST api/workflows/:workflowId/optimization-proposals` (body qua `ZodRequestPipe`).
  - Web:
    - `draftWorkflowSteps(departmentId, request)` và `proposeWorkflowOptimization(workflowId, request)` dùng `sendApiJson(..., workflowProposalSchema)`, không `invalidateApiQueries` vì không lưu gì.
    - `editableStepsFromBlueprints` đổi tham số thành `readonly WorkflowStepDraft[]`. Bước đề xuất bỏ `fromStepIndex` trước khi đưa vào editor, vì schema draft strict.

Giao diện:

- **Thanh "Bắt đầu từ mẫu"** có ba nút: "AI soạn bước", "AI tối ưu", "Xuất JSON".
- **`workflow-ai-panel.tsx`:**
  - Ô mục tiêu là textarea `maxLength 4000`, dán văn bản được; chỉ có ở chế độ soạn.
  - Ô chọn agent: agent `enabled` của phòng, mục đầu "Trưởng phòng (mặc định)".
  - Khi đang chờ hiện "AI đang soạn (tối đa 3 phút)".
- **Khi có kết quả:**
  - Bước đề xuất vào `editSteps` (chưa lưu).
  - Danh sách thay đổi/lý do/cảnh báo hiện trên chuỗi bước.
  - Danh sách bị xoá khi bấm "Bỏ thay đổi" hoặc khi lưu.
- **Xuất:**
  - `buildWorkflowExportDocument(workflow)` → `Blob` → `<a download="<tên>.aiteam-workflow.json">`, rồi `revokeObjectURL`.
  - Chỉ xuất bản đã lưu; nút tắt khi đang có thay đổi chưa lưu.
- **`workflow-form-panel.tsx`:**
  - Nguồn "Nhập từ JSON" gồm file `accept=".json,application/json"` (≤ 256 KB, `file.size`) hoặc textarea dán.
  - Đọc bằng `workflowExportDocumentSchema.safeParse(JSON.parse(text))`. Lỗi thì hiện thông báo.
  - Hợp lệ thì điền sẵn tên/mô tả khi đang trống; `toWorkflowSource` thêm `{ kind: 'import', document }`.

- [ ] **Step 1: Test hỏng**

```ts
// workflow-proposal-author.test.ts (staffDirectory/runner giả)
it('asks the department head by default, read-only and offline, keyed by department', ...);
  // runner.askAgentOnce gọi với { snapshot: objectContaining({ agentId: 'head', accessLevel: 'read_only', networkAccess: false }), runKey: 'workflow-ai:dept-1' }
it('falls back to the first available agent when the head is switched off', ...);
it('refuses an agent of another department without calling the engine', ...); // WORKFLOW_AI_AGENT_INVALID, runner không được gọi

// workflow-proposals.e2e.test.ts (ScriptedEngine; thành viên tạo như task-execution.e2e)
it('drafts steps and returns them unsaved (200)', ...);
  // engine.respond trả block(...); workflowProposalSchema.parse(body); engine.requests[0] toMatchObject
  // { workspaceRoot: null, permissions: { accessLevel: 'read_only', networkAccess: false } }; prompt chứa goal
it('refuses a draft request without Origin (403)', ...); // app.application.inject không header origin
it('refuses to optimize with fewer than 5 finished tasks, without calling the engine', ...); // 400 WORKFLOW_STATS_TOO_FEW, engine.requests rỗng
it('optimizes from 5 finished tasks and keeps ids through fromStepIndex', ...);
  // INSERT tasks 'succeeded' như workflows.e2e:208; sự kiện qua app.application.get(TASK_EVENT_LOG) (chưa flush);
  // AI trả fromStepIndex [1,0] → steps[0].id === workflow.steps[1].id, basedOnTaskCount 5, prompt chứa 'lượt'
```

- [ ] **Step 2: Chạy** `npm test -- workflow-proposal-author workflow-proposals.e2e` → FAIL.
- [ ] **Step 3: Hiện thực server**, nối dây trong `orchestration.module.ts`.
- [ ] **Step 4: Hiện thực web.**
- [ ] **Step 5: Chạy** test của task → PASS. `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle` đều sạch.
- [ ] **Step 6: Commit** `feat(workflows): AI draft, AI optimization, JSON export and import in the editor`

---

### Task 6: Định nghĩa bước "Phòng khác" (migration 015, contracts, lưu quy trình)

> **Điều chỉnh sau rà soát (bắt buộc):**
>
> - `packages/contracts/src/workflows.test.ts` đã có từ Task 2 → Modify, không tạo mới.
> - Phần 1 phải theo trường mới: `buildWorkflowExportDocument` chép `handoffDepartmentId`; `interpretWorkflowProposal` parse bằng `workflowProposalStepSchema.omit({ id: true, handoffDepartmentId: true })` (bước AI mang `handoffDepartmentId` → `AI_PROPOSAL_INVALID`); danh sách trường trong `buildWorkflowProposalPrompt` không có trường này. Thêm `workflow-proposal.ts`, `workflow-proposal-prompt.ts`, `workflow-proposal.test.ts` vào Files; test: `rejects an AI step that carries handoffDepartmentId`, `round-trips a handoff step through export and import`.
> - `ownDepartmentId = null` chỉ dùng trong test contracts; server và web luôn truyền id phòng.

**Files:**

- Create: `apps/server/src/shared/database/migrations/015_department_handoff.sql`
- Modify: `apps/server/src/shared/database/migrations/index.ts` (`{ version: 15, name: 'department-handoff', sql, rebuildsTables: true }`)
- Modify: `packages/contracts/src/enumerations.ts`, `packages/contracts/src/workflows.ts`
- Modify: `apps/server/src/modules/orchestration/domain/entities/workflow.ts`, `.../domain/workflow-templates.ts` (`step()` thêm `handoffDepartmentId: null`), `.../infrastructure/persistence/sqlite-workflow.repository.ts`
- Modify: `.../application/use-cases/workflow-lookup.ts`, `replace-workflow-steps.use-case.ts` (inject `DEPARTMENT_REPOSITORY`), `create-workflow.use-case.ts`
- Modify: `apps/server/src/modules/departments/domain/repositories/department-workload.repository.ts`, `.../infrastructure/persistence/sqlite-department-workload.ts`, `.../application/use-cases/delete-department.use-case.ts`
- Modify (chỉ để biên dịch): `apps/web/src/features/workflows/workflow-labels.ts` (`department: 'Phòng khác'`), `workflow-step-drafts.ts` (`editableStepsOf`/`appendNewStep` mang `handoffDepartmentId`), `workflow-editor.tsx` (gọi hàm problems với `workflow.departmentId`)
- Test: `apps/server/src/shared/database/migrations/015-department-handoff.test.ts`, `.../migrations/enumerations.test.ts`, `packages/contracts/src/workflows.test.ts` (mới), `apps/server/src/modules/orchestration/domain/entities/workflow.test.ts` (helper `draft()` thêm `handoffDepartmentId: null`), `apps/server/src/modules/orchestration/workflows.e2e.test.ts`

**Interfaces:**

- Produces:
  - `STEP_OWNERS = [...AGENT_ROLES, 'user', 'department'] as const`.
  - `workflowStepSchema.handoffDepartmentId: entityIdSchema.nullable()`; `workflowStepDraftSchema.handoffDepartmentId: entityIdSchema.nullable().default(null)`; `WorkflowStepState.handoffDepartmentId: string | null` (đi qua `copyStepBlueprints`, `toWorkflowDto`).
  - `listWorkflowStepProblems(steps: readonly StepRuleInput[], ownDepartmentId: string | null)`. `StepRuleInput` thêm `handoffDepartmentId: string | null`. Sửa mọi chỗ gọi (`grep "listWorkflowStepProblems("`). Code Phần 1 (đề xuất AI) truyền `null`.
  - `buildWorkflowSteps(drafts, existingIds, idGenerator, departmentId)`: `createNew` truyền `input.departmentId`, `replaceSteps` truyền `this.state.departmentId`.
  - `assertHandoffTargetsExist(departmentRepository: DepartmentRepository, steps: readonly { handoffDepartmentId: string | null }[]): void`: phòng không tồn tại thì ném `ValidationError` `WORKFLOW_HANDOFF_TARGET_NOT_FOUND`, message `Bước ${i+1}: Phòng nhận bàn giao không tồn tại.`, `details: WorkflowStepProblem[]` (mọi bước lỗi). Gọi trước `insertWorkflow`/`updateWorkflow`, trong transaction. `CreateWorkflowUseCase` gọi trên kết quả `resolveStartingSteps` (mọi nguồn, kể cả `import` của Phần 1).
  - `DepartmentWorkload.countHandoffStepsTargeting(departmentId: string): number`. `DeleteDepartmentUseCase` kiểm tra sau `DEPARTMENT_HAS_TASKS`, ném `ConflictError` `DEPARTMENT_RECEIVES_HANDOFFS` với message `Phòng "${name}" đang nhận bàn giao từ ${n} bước quy trình. Sửa các bước đó trước.`

Thông báo của problems (dùng nguyên văn, theo thứ tự kiểm):

| Điều kiện                                            | Message                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `department` và target `null`                        | `Chọn phòng nhận bàn giao.`                                 |
| không phải `department` mà có target                 | `Chỉ chọn phòng khi người phụ trách là "Phòng khác".`       |
| `ownDepartmentId !== null` và target bằng phòng mình | `Không bàn giao cho chính phòng mình.`                      |
| `department` ở `stepIndex === 0`                     | `Bước đầu tiên không giao phòng khác được.`                 |
| `department` và `gate !== 'auto'`                    | `Bước giao phòng khác chỉ dùng điều kiện "Tự động chuyển".` |
| `department` và `onFail === 'retry'`                 | `Bước giao phòng khác không dùng "Thử lại".`                |

- [ ] **Step 1: Test hỏng**

```ts
// workflows.test.ts
const step = (over = {}) => ({ ownerRole: 'dev', gate: 'auto', onFail: 'stop', returnToStepIndex: null, maxRetries: 0, handoffDepartmentId: null, ...over }) as const;
const handoff = step({ ownerRole: 'department', handoffDepartmentId: 'review', onFail: 'return_to_step', returnToStepIndex: 0 });
const messages = (steps, own) => listWorkflowStepProblems(steps, own).map((p) => p.message);
it('accepts a handoff after a working step', () => expect(messages([step(), handoff], 'dev')).toEqual([]));
it.each([...6 dòng của bảng...])('reports %s', ...);
it('skips the own-department check without a department', () => expect(messages([step(), { ...handoff, handoffDepartmentId: 'dev' }], null)).toEqual([]));
```

`015-department-handoff.test.ts` (theo mẫu 006/014): giữ bước và `fail_target_step_id` có từ trước, `handoff_department_id` = null, `tasks.handoff_task_id` = null. Có bộ chèn `insertStep(id, position, owner, gate, onFail, target, maxRetries)`. Cặp `department` + `auto` + `return_to_step` + `'review'` được nhận. Mỗi trường hợp sau ném `/CHECK constraint failed/`: thiếu target, target trên bước `dev`, gate `qc_pass`, `retry` với `max_retries` 1. Xoá phòng `review` đang được trỏ tới thì `/FOREIGN KEY constraint failed/`. Xoá phòng `dev` (có quy trình chứa bước bàn giao) thì thành công.

`enumerations.test.ts`: `insertRowWith` của `owner_role` dùng gate `'auto'` và `handoff_department_id = 'dept'` khi value là `'department'`, các value khác dùng `'user_approval'` và null.

`workflows.e2e.test.ts`:

- `saves a handoff step to another department`: PUT `[dev, handoff→review.id]` trả 200, `steps[1].handoffDepartmentId === review.id`.
- `refuses an unknown handoff department with 400`: PUT có `handoffDepartmentId: 'missing-dept'` trả 400 với `WORKFLOW_HANDOFF_TARGET_NOT_FOUND`. Gửi cùng bước đó qua POST `source: { kind: 'import', document }` cũng 400.
- `refuses to delete a department that receives handoffs`: DELETE review (rỗng) trả 409 `DEPARTMENT_RECEIVES_HANDOFFS`. Xoá phòng Dev xong thì DELETE review trả 204.

- [ ] **Step 2: Chạy** `npm test -- packages/contracts/src/workflows.test.ts apps/server/src/shared/database/migrations apps/server/src/modules/orchestration/workflows.e2e.test.ts` → FAIL.
- [ ] **Step 3: Hiện thực.** SQL dựng lại `workflow_steps` theo đúng khuôn 006: thêm cột `handoff_department_id TEXT REFERENCES departments (id)`, `owner_role IN (... 'user', 'department')`, `CHECK ((owner_role = 'department') = (handoff_department_id IS NOT NULL))`, `CHECK (owner_role <> 'department' OR (gate = 'auto' AND on_fail <> 'retry'))`. Sau đó `ALTER TABLE tasks ADD COLUMN handoff_task_id TEXT;`. Repository: `STEP_COLUMNS`, insert và update đọc/ghi `handoff_department_id` trong cùng câu lệnh với `owner_role`.
- [ ] **Step 4: Chạy lại** → PASS; `npm run lint` sạch.
- [ ] **Step 5: Commit** `feat(workflows): department handoff steps (migration 015)`

---

### Task 7: Gửi bàn giao, task bàn giao dừng ở gate không đạt đầu tiên

> **Điều chỉnh sau rà soát (bắt buộc):**
>
> - `recordOutcome(task, kind, detail, stepId, extra: Record<string, unknown> = {})`; nhánh dừng sớm của task bàn giao ghi `{ detail, stepId: state.currentStepId, reason: 'gate_rejected' }`.
> - Constructor `TaskProgression` thêm `TASK_REPOSITORY` → sửa `task-progression.test.ts` (Task 1) trong cùng task.
> - `Task.createHandoff` làm theo khuôn `Task.createSubtask` (`task.ts:118`): cùng lời gọi `createNew`, rồi đặt `parentTaskId`.
> - `handOffStep`: nếu `parent.worktreePath === null` (vd chuỗi `[user, department]`) → cha `failed` "Chưa có code để bàn giao: bước bàn giao phải đứng sau một bước có agent làm." trước khi tạo task con. Test `fails the parent when nothing was built before the handoff step`.

**Files:**

- Modify: `apps/server/src/modules/orchestration/domain/entities/task.ts`, `.../infrastructure/persistence/sqlite-task.repository.ts` (`handoff_task_id` vào `TASK_COLUMNS`, 26 placeholder, update, restore)
- Create: `apps/server/src/modules/orchestration/application/use-cases/department-handoff.ts`
- Modify: `resume-split-tasks.use-case.ts` (`export function clip`), `task-progression.ts`, `start-task-turn.use-case.ts`, `orchestration.module.ts` (provider `DepartmentHandoff`)
- Modify: `apps/server/src/modules/orchestration/domain/step-prompt.ts`
- Test: `.../domain/entities/task.test.ts`, `.../domain/task-execution-rules.test.ts`, `apps/server/src/modules/orchestration/department-handoff.e2e.test.ts` (mới, setup theo `subtasks.e2e.test.ts`)

**Interfaces:**

- Produces:
  - `TaskState.handoffTaskId: string | null`, getter `handoffTaskId`.
  - `Task.createHandoff(input: { id; sequenceNumber; parent: TaskState; departmentId; workflowId: string | null; assigneeAgentId; description }): Task`. Gọi `createNew` với `title`, `criteria`, `priority`, `testCommand`, `previewCommand`, `workingDirectory` của cha, rồi đặt `parentTaskId = parent.id`.
  - `waitForHandoff(stepId: string, childTaskId: string, note: string)`: đặt `status = 'waiting_children'`, `currentStepId = stepId`, `handoffTaskId`, `runAfter = null`, `statusNote = note`.
  - `finishHandoff()`: `handoffTaskId = null`.
  - `class DepartmentHandoff`. Constructor: `TASK_REPOSITORY`, `WORKFLOW_REPOSITORY`, `DEPARTMENT_REPOSITORY`, `STAFF_DIRECTORY`, `TASK_EVENT_LOG`, `TASK_WORKSPACE`, `TRANSACTION_RUNNER`, `ID_GENERATOR`, `TaskPlacementPolicy`, `TaskProgression`. Hàm `handOffStep(task: Task, step: WorkflowStepState): void` chạy đồng bộ và tự lưu.
  - `TaskProgression` inject thêm `TASK_REPOSITORY`. Đầu `applyGateResult`: nếu `!passed`, task có cha, và phòng của cha khác phòng của task, thì `task.fail(feedback ?? 'Không đạt.')`, ghi `task_failed` với payload `{ detail: feedback, reason: 'gate_rejected' }` (thêm tham số `extra` cho `recordOutcome`), rồi `return`. Áp dụng cả khi quy trình đích là free run.
  - `StepPromptInput.subtaskOf: { taskCode; title; handedOff: boolean } | null`. `handedOff` dùng câu nguyên văn: `Đây là task do phòng khác bàn giao từ task ${code} "${title}". Làm theo quy trình của phòng bạn; code của họ có sẵn trong thư mục làm việc. Báo đạt hoặc không đạt kèm lý do cụ thể: báo cáo của bạn được gửi lại cho phòng đó.`. Trong `buildPrompt`, `handedOff = parent.departmentId !== state.departmentId`.
  - `beginTurn`: ngay sau nhánh `ownerRole === 'user'`, nếu bước là `department` thì `this.departmentHandoff.handOffStep(task, step); return;` (thêm `DepartmentHandoff` vào cuối constructor).

`handOffStep` (`Y` là tên phòng đích):

1. Quy trình mặc định của phòng đích lấy qua `placement.resolveWorkflow(targetId, undefined)`. Nếu nó có bước `department` thì cha fail: `Quy trình mặc định của phòng ${Y} cũng có bước giao phòng khác; nền tảng không bàn giao lồng nhau.`
2. Nếu `staffDirectory.listDepartmentStaff(targetId)` rỗng thì cha fail: `Phòng ${Y} chưa có thành viên để nhận bàn giao.`
3. Người nhận là `placement.resolveAssignee(targetId, undefined)`. Description: `Phòng ${X} bàn giao bước «${step.name}» của ${code} "${title}".` + `Đầu ra cần có: …` (nếu có) + `Mô tả gốc:\n…` (nếu có) + `Kết quả các bước trước:` gồm `- ${stepName} (${agentName}): ${clip(summary)}` cho 3 mục cuối của `listStepReports`. Cắt còn `HANDOFF_DESCRIPTION_MAX_LENGTH = 8_000`.
4. Trong một transaction: `allocateSequenceNumber`, `insertTask(child)`, `task.waitForHandoff(step.id, child.id, \`Chờ phòng ${Y} (${childCode}) làm bước "${step.name}".\`)`, `updateTask`. Ghi event `handoff_sent`với`{ stepId, stepName, childTaskId, childCode, departmentName }`.

- [ ] **Step 1: Test hỏng**
  - `task.test.ts`: `createHandoff` thì `toMatchObject({ departmentId: 'review', workflowId: 'review-flow', assigneeAgentId: 'lead-review', parentTaskId: 'task-1', title: 'API đăng nhập', criteria: 'Đủ test', testCommand: 'npm test', priority: 2, status: 'queued', handoffTaskId: null })`. `waitForHandoff('step-review', 'child', 'Chờ…')` thì `{ status: 'waiting_children', currentStepId: 'step-review', handoffTaskId: 'child' }`. `finishHandoff()` thì `handoffTaskId: null`.
  - `task-execution-rules.test.ts`: prompt `handedOff` chứa `'task do phòng khác bàn giao từ task T-3 "Trang đăng nhập"'` và `'báo cáo của bạn được gửi lại'`, không chứa `'task con do cấp trên tách ra'`. Các test cũ thêm `handedOff: false`.
  - `department-handoff.e2e.test.ts`. Phòng Dev: head `Dev An` (dev). Phòng Review: head `QC Minh` (qc). Cả hai `edit_workspace`. Quy trình Review là `[Duyệt code: qc, qc_pass, retry, maxRetries 2]`. Quy trình Dev là `[Code: dev auto stop, Review: department→review, auto, return_to_step 0]`. Engine nhận ra lượt Review bằng chuỗi `'phòng khác bàn giao'`.
    - `hands the step to the head of the other department on its default workflow`: con có `departmentId`, `workflowId` và `assignee` đúng; worktree của con chứa file `turn-*` của Dev; cha ở `waiting_children` với `currentStep.name === 'Review'`; có `handoff_sent`; Dev chỉ có 1 request.
    - `ends a handed-off task at its first failed gate, ignoring the target workflow retries`: QC trả `fail` "Thiếu test". Con `failed` sau đúng 1 request QC, `status_note` chứa `Thiếu test`, `task_events.payload_json` của `task_failed` có `reason: 'gate_rejected'`.
    - `fails the parent before spending tokens when the target hands off again or has no members`: cha `failed` với hai message ở bước 1 và 2 của `handOffStep`, `subtasks: []`.
    - `deletes the handoff child with its parent`: DELETE cha khi đang chờ thì con trả 404.
- [ ] **Step 2: Chạy** `npm test -- task.test.ts task-execution-rules.test.ts department-handoff.e2e` → FAIL.
- [ ] **Step 3: Hiện thực** theo mô tả trên.
- [ ] **Step 4: Chạy** → PASS; lint sạch.
- [ ] **Step 5: Commit** `feat(orchestration): hand a workflow step off to another department`

---

### Task 8: Kết luận bàn giao, trần 3 vòng, tách task con không lẫn bàn giao

> **Điều chỉnh sau rà soát (bắt buộc):**
>
> - `ResumeSplitTasksUseCase` inject `DepartmentHandoff` (không vòng DI: `DepartmentHandoff` → `TaskProgression`).
> - Thêm e2e: xoá task con khi cha đang chờ → cha `failed`, ghi chú bắt đầu bằng `Phòng Review lỗi kỹ thuật (task đã xoá)`.

**Files:**

- Modify: `.../application/use-cases/department-handoff.ts`, `resume-split-tasks.use-case.ts`, `task-splitter.ts`
- Modify: `.../domain/repositories/task.repository.ts`, `.../infrastructure/persistence/sqlite-task.repository.ts`
- Modify: `.../application/ports/task-execution.ports.ts`, `apps/server/src/modules/tracing/infrastructure/persistence/batched-task-event-log.ts`
- Modify: `apps/server/src/modules/tracing/domain/describe-task-event.ts`
- Test: `department-handoff.e2e.test.ts`, `apps/server/src/modules/tracing/domain/describe-task-event.test.ts` (mới)

**Interfaces:**

- Produces:
  - `TaskRepository.listSplitSubtaskIds(parentTaskId: string): string[]` trả các task con cùng phòng với cha (JOIN `p.department_id = c.department_id`), sắp theo `sequence_number`. Dùng ở `TaskSplitter` (hạn mức `MAX_SUBTASKS_PER_TASK`) và vòng gộp của `resumeParentTask`. `listSubtaskIds` giữ nguyên cho xoá dây chuyền.
  - `TaskEventLog.listTaskEventsOfKinds(taskId: string, kinds: readonly string[]): TaskEventRecord[]`: flush trước, mới nhất trước, không có limit (`kind IN (SELECT value FROM json_each(?))`).
  - `DepartmentHandoff.concludeHandoff(parentId: string): Promise<void>`. `resumeParentTask` gọi nó ngay sau kiểm tra status khi `parent.handoffTaskId !== null`, rồi `return`.
  - `HANDOFF_ROUND_LIMIT = 3`. Đầu `handOffStep`: duyệt `listTaskEventsOfKinds(parentId, ['handoff_returned', 'task_retried'])` cho tới `task_retried`, đếm các `payload.stepId === step.id && payload.verdict === 'rejected'`. Đạt ≥ 3 thì cha fail: `Quá 3 vòng bàn giao cho phòng ${Y}.`

`concludeHandoff`:

- Con `succeeded` thì verdict là `passed`. Nếu cả hai worktree khác null thì `mergeSubtaskBranch(parent.worktreePath, child.id, \`${code}: gộp bàn giao ${childCode}\`)`. Gặp `conflict`thì`addFeedback(\`Code của phòng ${Y} (${childCode}) KHÔNG được gộp vì xung đột; nhánh agent/${childId} vẫn còn, tự gộp hoặc làm lại phần này.\`)`**trước**`applyGateResult(current, true, null)`.
- Con `failed` và `listTaskEventsOfKinds(childId, ['task_failed'])[0]?.payload.reason === 'gate_rejected'` thì verdict là `rejected`: `applyGateResult(current, false, \`Phòng ${Y} (${childCode}) không đạt: ${child.statusNote ?? ''}\`)`.
- Mọi trường hợp khác là `technical` (engine fail, cancelled, con đã bị xoá): `current.fail(\`Phòng ${Y} lỗi kỹ thuật (${childCode ?? 'task đã xoá'}). Bấm chạy lại để bàn giao vòng mới.\`)`.
- Sau khi gộp, đọc lại cha. Nếu cha không còn ở `waiting_children` thì `return`. Gọi `finishHandoff()` trước khi áp kết quả, sau đó `updateTask` và event `handoff_returned` với `{ stepId, childTaskId, childCode, departmentName, verdict }`.

- [ ] **Step 1: Test hỏng**
  - `describe-task-event.test.ts`: `handoff_sent {stepName: 'Review', departmentName: 'Review', childCode: 'T-13'}` thành `'bàn giao bước "Review" cho phòng Review (T-13)'`. `handoff_returned` với verdict `passed|rejected|technical` thành `'phòng Review (T-13) báo đạt' | '… báo không đạt' | '… báo lỗi kỹ thuật'`.
  - e2e:
    - `merges the other department's code and moves on when it passes`: cha `succeeded`, worktree cha chứa file `turn-*` của con, `handoff_returned.verdict === 'passed'`.
    - `sends the feedback back to the developer and hands off again`: vòng 1 QC `fail` "Thiếu test", vòng 2 `pass`. Prompt Dev thứ 2 chứa `'Phòng Review (T-'`, `'không đạt'`, `'Thiếu test'`. Cha `succeeded`, có 2 con. `app.application.get<TaskRepository>(TASK_REPOSITORY).listSplitSubtaskIds(parent.id)` là `[]`, còn `listSubtaskIds` có 2 phần tử.
    - `stops after 3 rejected rounds and counts again after a retry`: QC luôn `fail`. Cha `failed` với note `'Quá 3 vòng bàn giao cho phòng Review.'`, 3 con, 4 request Dev. Sau `POST /api/tasks/:id/retries` thì có con thứ 4.
    - `treats an engine failure in the other department as technical`: `failWith` trả `retryable: false` cho lượt Review. Note của cha bắt đầu bằng `'Phòng Review lỗi kỹ thuật'`, Dev chỉ có 1 request.
- [ ] **Step 2: Chạy** `npm test -- department-handoff.e2e describe-task-event subtasks.e2e` → FAIL.
- [ ] **Step 3: Hiện thực.**
- [ ] **Step 4: Chạy** (kèm `subtasks.e2e.test.ts` để bắt regression) → PASS; lint sạch.
- [ ] **Step 5: Commit** `feat(orchestration): conclude department handoffs with a 3-round cap`

---

### Task 9: Web: người phụ trách "Phòng khác", nhãn "Bàn giao từ T-x"

**Files:**

- Modify: `packages/contracts/src/tasks.ts` (`parentTask: { id, code, departmentId: entityIdSchema } | null`), `.../infrastructure/persistence/sqlite-task-board.query.ts` (`p.department_id AS parent_department_id`)
- Modify: `apps/web/src/features/workflows/workflow-step-drafts.ts`, `components/workflow-editor.tsx`, `components/workflows-screen.tsx`
- Modify: `apps/web/src/features/tasks/components/task-board.tsx`, `task-detail-panel.tsx`
- Test: `department-handoff.e2e.test.ts` (thêm assertion)

**Interfaces:**

- Produces:
  - `changeStepOwner`: chọn `'department'` thì `gate: 'auto'`, `onFail` từ `retry` đổi thành `stop`, `maxRetries: 0`. Rời `'department'` thì `handoffDepartmentId: null`.
  - `WorkflowEditor` nhận thêm prop `departments: readonly Department[]` (`workflows-screen.tsx` đã có `departmentList`, không thêm hook hay request). Ô chọn phòng (bỏ phòng của quy trình) chỉ hiện khi owner là `department`. Gate chỉ có `auto`. "Khi không đạt" bỏ `retry`. `StepCard` hiện `Phòng khác · ${tên}`.
  - Board và chi tiết task: phòng của `parentTask` khác phòng của task thì hiện `Bàn giao từ ${code}`, ngược lại vẫn `Task con của ${code}`.

- [ ] **Step 1: Test hỏng.** Trong test đầu của Task 7, summary của con có `parentTask.departmentId === devDepartment.id`.
- [ ] **Step 2: Chạy** `npm test -- department-handoff.e2e` → FAIL.
- [ ] **Step 3: Hiện thực.** Web không có Vitest. Kiểm tay bằng `node bin/aiteam.mjs`: thêm bước "Phòng khác", lưu, rồi xem nhãn trên board.
- [ ] **Step 4: Chạy** `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle` → PASS.
- [ ] **Step 5: Commit** `feat(web): "Phòng khác" step owner and handoff labels`

---

### Task 10: Dữ liệu tri thức: migration 016, nguồn bài học, domain chỉ mục và bản tóm tắt

**Files:**

- Create: `apps/server/src/shared/database/migrations/016_knowledge.sql`
- Modify: `apps/server/src/shared/database/migrations/index.ts` (`{ version: 16, name: 'knowledge', sql: knowledgeSql }`, không rebuild)
- Modify: `packages/contracts/src/enumerations.ts`
- Create: `packages/contracts/src/knowledge.ts`, Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/knowledge/domain/code-outline.ts`, `apps/server/src/modules/knowledge/domain/knowledge-briefing.ts`
- Test: `apps/server/src/shared/database/migrations/016-knowledge.test.ts` (theo khuôn `014-task-review-pending.test.ts`), `.../migrations/enumerations.test.ts`, `apps/server/src/modules/knowledge/domain/code-outline.test.ts`, `.../domain/knowledge-briefing.test.ts`

**Interfaces:**

- Produces (contracts): `KNOWLEDGE_LESSON_SOURCES = ['review_feedback','qc_feedback','user_review','agent_failure','agent_learning'] as const`, `knowledgeLessonSourceSchema`, `KnowledgeLessonSource`; `LESSON_BODY_MAX_LENGTH = 1_500`; `knowledgeLessonSchema {id, projectKey, source, body, paths: string[], occurrences: int≥1, sourceTaskCode: string|null, updatedAt}`, `knowledgeLessonListSchema`, `updateLessonRequestSchema {body: trim 1..1500}`, `lessonListQuerySchema {q: trim max 200, default ''}`.
- Produces (domain, thuần, không import Nest/sqlite):
  - `extractCodeOutline(path: string, text: string): { exportedNames: string[]; importSpecifiers: string[] }`: cả hai mảng sort + unique. `*/package.json` → `exportedNames = [name]` (JSON.parse lỗi → rỗng).
  - `resolveImportPath(fromPath: string, specifier: string, index: { paths: ReadonlySet<string>; packageDirectories: ReadonlyMap<string, string> }): string | null`. JS/TS: tương đối (`.js/.mjs/.cjs` thử lại bằng đuôi TS), đuôi `.ts .tsx .js .mjs .cjs`, `index.*`; gói workspace: `<dir>/<sub>` rồi `<dir>/src/<sub>`, mặc định `src/index.*`, `index.*`; ra ngoài repo → null. Python (`fromPath` kết thúc `.py`): `a.b` → `a/b.py` | `a/b/__init__.py` tính từ gốc; `.x` tính từ thư mục của file.
  - `tokenizeSearchText(text: string): Set<string>`: NFD, bỏ `\p{M}`, `đ→d`, tách camelCase, chữ thường, `[\p{L}\p{N}_]{3,}`.
  - `scoreTokenOverlap(query: ReadonlySet<string>, terms: ReadonlySet<string>): number`.
  - `normalizeLessonText(text: string): string`: bỏ ký tự điều khiển (giữ `\n`), bỏ thẻ `/<\/?aiteam-[^>]*>/gi`, ` ``` ` → `'''`, bỏ tiền tố riêng của task (`^.{1,80} \(cấp trên\) yêu cầu sửa:\s*`, `^Agent báo không hoàn thành:\s*`, `^QC chưa xác nhận đạt:\s*`, `^Người dùng từ chối kết quả bước\.\s*Ghi chú:\s*`, `^Phòng .{1,80} \(T-\d+\) không đạt:\s*`), trim, cắt 1500.
  - `hashLessonBody(body: string): string`: sha256 hex của body đã viết thường, gộp khoảng trắng.
  - `findMentionedCodePaths(body: string): string[]`: token `[\w@.\-/\\]+\.(tsx?|jsx?|mjs|cjs|py)`, `\`→`/`, bỏ `./` ở đầu, unique, ≤ 10.
  - `buildKnowledgeBriefing(input: { relevantLessons: BriefingLesson[]; relevantFiles: BriefingFile[]; allLessons: BriefingLesson[]; allFiles: BriefingFile[] }): { promptSection: string | null; lessonsMarkdown: string; codeMapMarkdown: string }`, trong đó `BriefingLesson {body, occurrences, source}`, `BriefingFile {path, exportedNames, importedBy, imports}`. Prompt: mục "Bài học rút ra từ các lần trước:" (mỗi dòng của bài học đều có tiền tố `> `, lấy trọn bài hoặc bỏ qua) rồi "Bản đồ code liên quan:" (`- <path> | export: … | được import bởi: … | import: …`, phần nào rỗng thì bỏ); dừng ở ranh giới dòng, ≤ `KNOWLEDGE_PROMPT_MAX_LENGTH = 6_000`; cả hai phần đều rỗng → `null`. Mỗi file `.md` ≤ `200 * 1024` byte (`Buffer.byteLength`), cắt ở ranh giới dòng.

Migration (chỉ thêm): `ALTER TABLE tasks ADD COLUMN repository_root TEXT;` `code_files(project_key TEXT NOT NULL, path TEXT NOT NULL, blob_sha TEXT NOT NULL, exported_names TEXT NOT NULL DEFAULT '[]', search_terms TEXT NOT NULL DEFAULT '', UNIQUE(project_key, path))`; `code_imports(project_key, from_path, to_path, PRIMARY KEY(project_key, from_path, to_path)) WITHOUT ROWID` + `CREATE INDEX idx_code_imports_target ON code_imports (project_key, to_path)`; `knowledge_lessons` đúng cột của spec 5.3 (`id TEXT PRIMARY KEY`, `department_id … ON DELETE SET NULL`, `source_task_id … ON DELETE SET NULL`, `source CHECK (source IN (…5 giá trị…))`, `body CHECK (length(body) BETWEEN 1 AND 1500)`, `paths_json TEXT NOT NULL DEFAULT '[]'`, `occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1)`, `created_at`/`updated_at` dùng `strftime` như 012, `UNIQUE(project_key, body_hash)`) + index `(project_key, occurrences DESC)`.

- [ ] **Step 1: Viết test hỏng**

````ts
// 016-knowledge.test.ts: migrate tới bản <16, seed phòng 'dev' + task 't1', rồi migrate lên bản mới nhất
it('gives existing tasks no repository root', …toEqual({ repository_root: null }));
it('rejects an unknown source and bodies outside 1..1500', …/CHECK constraint failed/ cho 'other', '', 'x'.repeat(1501));
it('counts one body once per repository', …/UNIQUE constraint failed/ khi cùng (project_key, body_hash));
it('keeps lessons when the department or task is deleted', …department_id và source_task_id thành null);
// enumerations.test.ts: thêm { table: 'knowledge_lessons', column: 'source', contractValues: KNOWLEDGE_LESSON_SOURCES, invalidValue: 'chat', insertRowWith: INSERT (id, project_key, source, body, body_hash) VALUES (?, 'repo', ?, 'b', ?) với body_hash = rowId }
// code-outline.test.ts
expect(extractCodeOutline('src/a.ts', ["import { b } from './b';", "import type { C } from '../lib/c.js';",
  'export async function login() {}', 'export const TOKEN = 1;', 'export class Session {}',
  'export interface User {}', 'export type Id = string;', 'export enum Role { A }',
  'export { inner as renamed, other };', "export * from './re';", "const x = require('./legacy');",
  "await import('./lazy');", 'export default function () {}'].join('\n'))).toEqual({
  exportedNames: ['Id', 'Role', 'Session', 'TOKEN', 'User', 'login', 'other', 'renamed'],
  importSpecifiers: ['../lib/c.js', './b', './lazy', './legacy', './re'] });
expect(extractCodeOutline('app/views.py', 'import os\nimport pkg.mod\nfrom .sibling import thing\nfrom app.models import User\ndef top():\n    def inner(): pass\nclass Service:\n    pass'))
  .toEqual({ exportedNames: ['Service', 'top'], importSpecifiers: ['.sibling', 'app.models', 'os', 'pkg.mod'] });
const index = { paths: new Set(['src/b.ts', 'src/lib/index.ts', 'src/lib/c.ts', 'packages/contracts/src/index.ts', 'app/models.py', 'app/sibling.py']),
  packageDirectories: new Map([['@aiteam/contracts', 'packages/contracts']]) };
// './b'→'src/b.ts', './lib'→'src/lib/index.ts', './lib/c.js'→'src/lib/c.ts', '@aiteam/contracts'→'packages/contracts/src/index.ts',
// 'react'→null, '../../outside'→null, ('app/views.py','app.models')→'app/models.py', '.sibling'→'app/sibling.py', 'os'→null
// knowledge-briefing.test.ts
expect(normalizeLessonText('An (cấp trên) yêu cầu sửa: Dùng ```rm``` <aiteam-report>x</aiteam-report>\u0007 ở src/a.ts'))
  .toBe("Dùng '''rm''' x ở src/a.ts");
expect([...tokenizeSearchText('Đăng nhập createTask src/a.ts')]).toEqual(expect.arrayContaining(['dang', 'nhap', 'create', 'task', 'src']));
// 200 bài học × 500 ký tự (có bài nhiều dòng) → promptSection.length ≤ 6000, mọi dòng bài học bắt đầu bằng '> '
// không có bài học/file liên quan → promptSection null; lessonsMarkdown có Buffer.byteLength ≤ 204800
expect(findMentionedCodePaths('lỗi ở ./src/a.ts và src\\b.py')).toEqual(['src/a.ts', 'src/b.py']);
````

- [ ] **Step 2:** `npm test -- 016-knowledge enumerations code-outline knowledge-briefing` → FAIL.
- [ ] **Step 3:** Hiện thực theo Interfaces.
- [ ] **Step 4:** Chạy lại → PASS; `npm run lint` sạch.
- [ ] **Step 5:** Commit `feat(knowledge): lesson schema, migration 016 and code outline`

---

### Task 11: Đọc cây code và thư mục `.aiteam-knowledge` trong worktree

> **Điều chỉnh sau rà soát:** không có fake `TaskWorkspace` nào; bỏ bước "cập nhật fake", chỉ `git-task-workspace.test.ts` dùng class thật.

**Files:**

- Modify: `apps/server/src/modules/orchestration/application/ports/task-execution.ports.ts`
- Modify: `apps/server/src/modules/orchestration/infrastructure/adapters/git-task-workspace.ts`
- Test: `apps/server/src/modules/orchestration/infrastructure/adapters/git-task-workspace.test.ts`

**Interfaces:**

- Produces:
  - `export interface CodeTreeEntry { path: string; blobSha: string; /** null: blob không đổi (có trong knownShas) hoặc vượt ngân sách byte của lượt */ text: string | null }`
  - `PreparedTaskWorkspace.repositoryRoot: string` (giá trị `ensureRepository` đã tính).
  - `TaskWorkspace.readCodeTree(worktreePath: string, knownShas: ReadonlyMap<string, string>): Promise<CodeTreeEntry[]>`: `git ls-tree -r -l -z --full-tree HEAD`; chỉ type `blob` với mode `100644|100755`; đuôi `.ts .tsx .js .mjs .cjs .py` hoặc tên `package.json`; size ≤ 256 KB; lấy 5000 mục đầu. Blob có sha khác `knownShas.get(path)` đọc bằng **một** `git cat-file --batch` (sha qua stdin, `encoding: 'buffer'`, cùng `SAFE_GIT_OPTIONS` và env của `runGit`), tổng ≤ 8 MB mỗi lượt (vượt → `text: null`). Blob có NUL trong 8000 byte đầu → `text: ''`. Không mở file trong worktree.
  - `TaskWorkspace.replaceKnowledgeFolder(worktreePath: string, agentDirectory: string, files: { lessonsMarkdown: string; codeMapMarkdown: string } | null): Promise<string | null>`: theo mẫu `copySkills`: `removeUnlessRealEntry` + `rmSync` thư mục `.aiteam-knowledge`; `null` → trả `null`; nếu không thì `mkdir`, `excludeFromGit(worktreePath, '.aiteam-knowledge')`, ghi đúng `lessons.md` và `code-map.md`, trả `'.aiteam-knowledge'`.

- [ ] **Step 1: Test hỏng** (describe mới, repo tạm; tạo mục symlink/submodule bằng `git update-index --add --cacheinfo 120000,<sha>,link.ts` / `160000,<HEAD>,vendor/sub` để chạy được trên mọi OS)

```ts
it('lists only small regular source files and reads their text', …
  expect(tree.map((entry) => entry.path)).toEqual(['package.json', 'src/a.ts', 'src/b.ts']); // không có big.ts (>256 KB), notes.md, link.ts, vendor/sub
  expect(tree.find((entry) => entry.path === 'src/a.ts')?.text).toBe("import { b } from './b';"));
it('does not read blobs it already knows', … lần 2 truyền Map path→blobSha của lần 1 → mọi text là null);
it('writes the knowledge folder out of git and removes a planted junction', … symlinkSync(outside, <agentDir>/.aiteam-knowledge, 'junction');
  expect(await workspace.replaceKnowledgeFolder(wt, wt, { lessonsMarkdown: 'L', codeMapMarkdown: 'C' })).toBe('.aiteam-knowledge');
  expect(existsSync(path.join(outside, 'lessons.md'))).toBe(false); expect(await workspace.saveCheckpoint(wt, 'm')).toBeNull());
it('removes the folder when there is no knowledge', … replaceKnowledgeFolder(wt, wt, null) → null, thư mục không còn);
it('gives a forked task the parent repository root', … task-1 và task-2 (forkFromTaskId 'task-1'), cả hai workingDirectory null → repositoryRoot bằng nhau);
```

- [ ] **Step 2:** `npm test -- git-task-workspace` → FAIL.
- [ ] **Step 3:** Hiện thực. Thêm hàm riêng `readGitBlobs(directory, shas): Promise<Map<string, Buffer>>` (dùng `execFile` + `child.stdin.end()`, parse header `<sha> blob <size>\n` theo byte). Cập nhật fake `TaskWorkspace` trong test nào có (grep `prepareTaskWorkspace:`).
- [ ] **Step 4:** PASS; lint sạch.
- [ ] **Step 5:** Commit `feat(orchestration): read the code tree and knowledge folder in the worktree`

---

### Task 12: Module knowledge: chỉ mục, bài học, route và màn hình bài học

> **Điều chỉnh sau rà soát (bắt buộc):**
>
> - `LessonsSection` gắn ngay dưới `DepartmentSkills` (`skills-screen.tsx:68`), trong cùng tab phòng.
> - Path trong bài học: input `recordLesson` thêm `agentDirectory: string | null` (thư mục làm việc tương đối với gốc repo); `findMentionedCodePaths` ghép path tương đối của agent với thư mục đó trước khi khớp `code_files` (path theo gốc repo, `--full-tree`). Test `links a lesson from a task in a subfolder to the repo-root path`.

**Files:**

- Modify: `.../orchestration/application/ports/task-execution.ports.ts` (port `TASK_KNOWLEDGE`)
- Create: `apps/server/src/modules/knowledge/domain/repositories/code-index.repository.ts`, `.../domain/repositories/knowledge-lesson.repository.ts`
- Create: `.../knowledge/infrastructure/persistence/sqlite-code-index.repository.ts`, `.../sqlite-knowledge-lesson.repository.ts`
- Create: `.../knowledge/application/use-cases/code-index.use-cases.ts` (`RefreshCodeIndexUseCase`, `DescribeTaskKnowledgeUseCase`), `.../lesson.use-cases.ts` (`RecordLessonUseCase`, `ListLessonsUseCase`, `UpdateLessonUseCase`, `DeleteLessonUseCase`), `.../task-knowledge-library.ts`
- Create: `.../knowledge/presentation/controllers/lessons.controller.ts`, `.../knowledge/knowledge.module.ts`
- Modify: `apps/server/src/app.module.ts`, `.../orchestration/orchestration.module.ts` (import `KnowledgeModule`, `{ provide: TASK_KNOWLEDGE, useExisting: TaskKnowledgeLibrary }` giống `AGENT_SKILL_SOURCE`)
- Create: `apps/web/src/features/skills/components/lessons-section.tsx`; Modify: `apps/web/src/features/skills/skills-api.ts`, `.../components/skills-screen.tsx`, `.../components/skills.module.css`
- Test: `.../knowledge/application/use-cases/knowledge.use-cases.test.ts` (SQLite trong bộ nhớ + `applyPendingMigrations(ALL_MIGRATIONS)` + repository thật + `SqliteTransactionRunner`), `.../knowledge/lessons.e2e.test.ts`

**Interfaces:**

- Produces (port, orchestration):

```ts
export const TASK_KNOWLEDGE = Symbol('TASK_KNOWLEDGE');
export interface TaskKnowledgeBriefing {
  promptSection: string | null;
  lessonsMarkdown: string;
  codeMapMarkdown: string;
}
export interface TaskKnowledge {
  refreshCodeIndex(
    projectKey: string,
    readTree: (knownShas: ReadonlyMap<string, string>) => Promise<readonly CodeTreeEntry[]>,
  ): Promise<void>;
  describeTaskKnowledge(input: {
    projectKey: string;
    keywords: readonly string[];
    relatedPaths: readonly string[];
  }): TaskKnowledgeBriefing;
  recordLesson(input: {
    projectKey: string;
    departmentId: string;
    sourceTaskId: string;
    source: KnowledgeLessonSource;
    body: string;
  }): void;
  listFrequentLessons(projectKey: string, limit: number): string[];
}
```

`TaskKnowledgeLibrary` hiện thực port này (khai báo lại kiểu theo cấu trúc như `AgentSkillLibrary`, không import port), uỷ quyền cho các use case; `listFrequentLessons` gọi thẳng repository (sắp theo occurrences giảm dần, rồi updated_at).

- Refresh: đọc `blob_sha` theo path → `readTree(known)`; tính outline, cứ 200 file `await setImmediate()` (`node:timers/promises`) một lần; xong mới ghi trong **một** transaction đồng bộ: upsert file có `text !== null` (exports JSON, `search_terms` = token của path và exports, thay import đã resolve của chính file đó), xoá file và import của path không còn trong cây, giữ nguyên dòng có `text === null`. `packageDirectories` lấy từ các dòng `package.json` (cả cũ lẫn mới). `// ponytail:` import của file không đổi không resolve lại khi file đích mới xuất hiện.
- Describe: token của keywords. Bài học = bài có `paths` giao với `relatedPaths` + top 8 theo điểm (> 0). File = `relatedPaths` có trong chỉ mục + top 10 theo điểm, mỗi file kèm ≤ 10 importer và các file nó import → `buildKnowledgeBriefing` (all = mọi bài học/file của repo).
- Record: `normalizeLessonText`, rỗng → bỏ; trùng `hashLessonBody` → `occurrences + 1`, gộp paths (≤ 10), `updated_at`. Paths = `findMentionedCodePaths(body)` chỉ giữ path có trong `code_files` của repo. Mỗi repo giữ ≤ 500 bài: vượt thì xoá bài có occurrences thấp nhất, cũ nhất.
- Routes (`@Controller('api')`, pipe như `skills.controller.ts`): `GET departments/:departmentId/lessons` (`lessonListQuerySchema`; bài học có `project_key IN (SELECT repository_root FROM tasks WHERE department_id = ?)`; `q` rỗng → sắp theo occurrences, có `q` → chỉ bài có điểm > 0, sắp theo điểm; ≤ 200 bài), `PATCH lessons/:lessonId` (`updateLessonRequestSchema`, normalize, trùng hash bài khác → `ConflictError LESSON_DUPLICATE`, không có → `NotFoundError LESSON_NOT_FOUND`), `DELETE lessons/:lessonId` → 204. `sourceTaskCode` qua `formatTaskCode` (orchestration `domain/entities/task`).
- Web: `loadDepartmentLessons(departmentId, q)`, `updateLesson`, `deleteLesson` (theo `refreshAfterWrite`); `LessonsSection` đặt dưới `DepartmentSkills` trong `skills-screen.tsx`: ô tìm, danh sách (nhãn nguồn, "gặp N lần", mã task), sửa tại chỗ, xoá có xác nhận; `useActionOutcome`/`StatusNotice` cho lỗi 409.

- [ ] **Step 1: Test hỏng**

```ts
it('indexes files and imports, then drops deleted files with their imports', … cây 1: src/a.ts ("import { b } from './b'") + src/b.ts
  → code_imports [{from_path:'src/a.ts', to_path:'src/b.ts'}]; cây 2 nhận Map có cả 'src/a.ts' và 'src/b.ts', chỉ trả a (text null) → không còn dòng nào của b);
it('keeps the old row of a changed file it could not read this turn', … sha mới + text null → blob_sha cũ);
it('counts a repeated lesson once and keeps only indexed paths', … 'Sai ở src/a.ts và src/zzz.ts' hai lần (khác hoa thường/khoảng trắng) → 1 dòng, occurrences 2, paths_json '["src/a.ts"]');
it('briefs lessons tied to the files the task touched even without a keyword match', …);
it('briefs nothing for an empty project', … promptSection null);
it('refuses an edit that duplicates another lesson', … rejects.toMatchObject({ code: 'LESSON_DUPLICATE' }));
// lessons.e2e.test.ts (seed task có repository_root và bài học bằng SQL)
// GET ?q=dang → chỉ bài khớp; PATCH {body:''} → 400; PATCH trùng → 409 LESSON_DUPLICATE; DELETE → 204;
// GET thiếu cookie (app.application.inject không có cookie) → 403 SESSION_REQUIRED
```

- [ ] **Step 2:** `npm test -- knowledge.use-cases lessons.e2e` → FAIL.
- [ ] **Step 3:** Hiện thực + nối dây.
- [ ] **Step 4:** PASS; `npm run lint`; `npm run build && npm run check:bundle` (code ứng dụng ≤ 70 KB).
- [ ] **Step 5:** Commit `feat(knowledge): code index, lessons API and lessons screen`

---

### Task 13: Mỗi lượt nhận tri thức của dự án

> **Điều chỉnh sau rà soát (bắt buộc):** `canUseNetwork = prepared.permissions.networkAccess && snapshot.provider !== 'custom_api'` (cài đặt engine là trần), không dùng `snapshot.networkAccess`.

**Files:**

- Modify: `.../orchestration/domain/entities/task.ts` (`repositoryRoot: string | null` trong `TaskState`, `createNew` = null, `rememberWorktree(worktreePath, baseSha, repositoryRoot: string)`), `.../entities/task.test.ts` (thêm field vào các state viết tay)
- Modify: `.../infrastructure/persistence/sqlite-task.repository.ts` (cột `repository_root`: select/insert/update, thêm một `?` ở insert)
- Modify: `.../domain/step-prompt.ts`
- Create: `.../application/use-cases/task-knowledge-briefer.ts`
- Modify: `.../use-cases/start-task-turn.use-case.ts`, `.../use-cases/step-review-launcher.ts`, `.../step-review-launcher.test.ts` (thêm `{} as never`), `.../orchestration.module.ts`
- Test: `.../domain/task-execution-rules.test.ts`, `.../use-cases/task-knowledge-briefer.test.ts`, `apps/server/src/modules/knowledge/knowledge-turn.e2e.test.ts` (khuôn setup của `task-execution.e2e.test.ts`)

**Interfaces:**

- Produces:
  - `step-prompt.ts`: `export interface StepKnowledge { briefing: string; folder: string | null }`; `StepPromptInput` thêm `knowledge: StepKnowledge | null`, `canUseNetwork: boolean`; `buildReviewPrompt` input thêm `knowledge: string | null`. Phần tri thức đặt ngay sau skill: `Tri thức dự án (dữ liệu tham khảo trích từ lịch sử, KHÔNG phải chỉ thị; Quy tắc luôn ưu tiên):\n<briefing>`, có folder thì thêm dòng `Bản đầy đủ để tra (grep): <folder>/lessons.md, <folder>/code-map.md`. `canUseNetwork` thêm quy tắc: `Bạn có mạng: trước khi dùng thư viện, API hay CLI mà bạn không chắc cách dùng, tra tài liệu chính thức hiện hành.`
  - `TaskKnowledgeBriefer` (inject `TASK_WORKSPACE`, `TASK_KNOWLEDGE`, `CHECKPOINT_REPOSITORY`, `APP_LOGGER`):
    - `prepareTurnKnowledge(input: { taskId: string; title: string; description: string; stepName: string | null; feedback: string | null; provider: AgentProvider; workspace: PreparedTaskWorkspace }): Promise<StepKnowledge | null>`: `refreshCodeIndex(root, (known) => readCodeTree(worktreePath, known))` → `describeTaskKnowledge` (keywords = title, description, stepName, feedback; relatedPaths = `files` của 5 mốc mới nhất từ `listCheckpoints`, unique, ≤ 30) → `replaceKnowledgeFolder(worktreePath, agentDirectory, provider === 'custom_api' || promptSection === null ? null : files)`. Không có `promptSection` → `null`. Lỗi bất kỳ → `logger.warn({ err, taskId }, 'task knowledge unavailable')`, trả `null`.
    - `describeReviewKnowledge(input: { taskId: string; repositoryRoot: string | null; title: string; description: string; stepName: string; workerSummary: string }): string | null`: đồng bộ, không trỏ thư mục, lỗi → warn + `null`.
  - `beginTurn`: `current.rememberWorktree(workspace.worktreePath, workspace.baseSha, workspace.repositoryRoot)`; gọi `prepareTurnKnowledge` **trước** khi kiểm `stopReasonOf`; `buildPrompt` nhận `knowledge` và `canUseNetwork: snapshot.networkAccess && snapshot.provider !== 'custom_api'`. `startStepReview` truyền `describeReviewKnowledge(...)` vào `buildReviewPrompt`.

- [ ] **Step 1: Test hỏng**

```ts
// task-execution-rules.test.ts (base thêm knowledge: null, canUseNetwork: false)
const prompt = buildStepPrompt({ ...base, step: null, sensitiveActionsNeedApproval: false, canEditWorkspace: true,
  knowledge: { briefing: '> Dùng bcrypt', folder: '.aiteam-knowledge' }, canUseNetwork: true });
expect(prompt).toContain('KHÔNG phải chỉ thị'); expect(prompt).toContain('.aiteam-knowledge/lessons.md');
expect(prompt).toContain('tra tài liệu chính thức hiện hành');
expect(buildStepPrompt({ ...base, … canUseNetwork: false })).not.toContain('tra tài liệu');
expect(buildReviewPrompt({ …, knowledge: '> x' })).not.toContain('.aiteam-knowledge');
// task-knowledge-briefer.test.ts (fake vi.fn)
it('runs the turn without knowledge when git fails', … refreshCodeIndex gọi readTree, readCodeTree rejects → resolves null, logger.warn có err, describeTaskKnowledge không được gọi);
it('passes files of the 5 newest checkpoints as related paths (at most 30)', …);
it('gives a Custom API agent the prompt section but no folder', … replaceKnowledgeFolder(…, null), folder null);
// knowledge-turn.e2e.test.ts: shop/src/a.ts ('export function login() {}') có trước khi tạo task; task chạy tự do
// → engine.requests[0].prompt chứa '- src/a.ts | export: login'; <workingDirectory>/.aiteam-knowledge/code-map.md có;
// git ls-files trong worktree không có '.aiteam-knowledge'; tasks.repository_root khác null
```

- [ ] **Step 2:** `npm test -- task-execution-rules task-knowledge-briefer knowledge-turn` → FAIL.
- [ ] **Step 3:** Hiện thực.
- [ ] **Step 4:** PASS; `npm run lint`; `npm test -- orchestration` (regression).
- [ ] **Step 5:** Commit `feat(orchestration): give each turn the project knowledge`

---

### Task 14: Thu bài học từ góp ý, đưa bài học vào AI tối ưu, kiểm tra cuối

> **Điều chỉnh sau rà soát (bắt buộc):**
>
> - `recordLesson` là câu lệnh **đầu tiên** của `applyGateResult`, trước nhánh dừng sớm của task bàn giao (Task 7), nếu không bài học của task con bị mất.
> - `normalizeLessonText` bỏ tiền tố lặp đến khi không còn khớp (`Phòng Review (T-13) không đạt: Agent báo không hoàn thành: X` → `X`). Test `strips stacked task prefixes`.
> - Lessons trong prompt tối ưu: biến thể optimize của `WorkflowProposalMode` thêm `frequentLessons: readonly string[]` (≤ 10).
> - Constructor `TaskProgression` thêm `TASK_KNOWLEDGE`, `APP_LOGGER` → sửa `task-progression.test.ts`.

**Files:**

- Modify: `.../orchestration/domain/agent-report.ts`, `.../domain/step-prompt.ts`
- Modify: `.../use-cases/task-progression.ts`, `finish-task-turn.use-case.ts`, `step-review-launcher.ts`, `decide-approval.use-case.ts`, `submit-code-review.use-case.ts`, `department-handoff.ts` (Phần 2)
- Modify: `.../domain/repositories/task.repository.ts` + `sqlite-task.repository.ts` (`findLatestRepositoryRoot`)
- Modify: `.../domain/workflow-proposal-prompt.ts` và `ProposeWorkflowOptimizationUseCase` (Phần 1, đúng đường dẫn Phần 1 đã tạo)
- Test: `.../domain/task-execution-rules.test.ts`, `workflow-proposal-prompt.test.ts` (Phần 1), `apps/server/src/modules/knowledge/knowledge-turn.e2e.test.ts`

**Interfaces:**

- Produces:
  - `AgentReport.learnings: string[]`: schema `learnings: z.array(z.unknown()).max(20).default([])`, kiểm từng mục bằng `z.string().trim().min(15).max(400)`, giữ 3 mục đầu; mục hỏng bị bỏ; báo cáo không hợp lệ → `[]`. Sửa các `toEqual` cũ của `interpretAgentReport` (thêm `learnings: []`).
  - Quy tắc mới trong `buildStepPrompt`: `Nếu rút ra được điều tổng quát đáng nhớ cho các task sau ở repo này (không phải chi tiết riêng của task), thêm "learnings": ["…"] (tối đa 3 câu) vào khối báo cáo.`
  - `TaskProgression` inject thêm `TASK_KNOWLEDGE`, `APP_LOGGER`; `recordLesson(task: Task, source: KnowledgeLessonSource, body: string): void`: `repositoryRoot` null → bỏ qua; lỗi → `logger.warn({ err, taskId })` (không log body). `applyGateResult(task, passed, feedback, lessonSource: KnowledgeLessonSource | null = null)`: ở đầu hàm, `!passed && lessonSource !== null && feedback !== null` → `recordLesson`.
  - Nguồn: `finish-task-turn`: chạy tự do → `'agent_failure'`; agent báo `fail` ở một bước → `step.gate === 'qc_pass' ? 'qc_feedback' : 'agent_failure'`; QC không `pass` → `'qc_feedback'`; tests → mặc định `null`. `applyGate` riêng thêm `lessonSource` ngay sau `feedback`, `detail` dời ra sau. `step_report` hợp lệ: mỗi `learnings` → `recordLesson(task, 'agent_learning', …)`. Launcher → `'review_feedback'`. decide-approval → `approval.kind === 'step_gate' && note !== null ? 'user_review' : null`. SubmitCodeReview (yêu cầu sửa): mỗi góp ý mở → `recordLesson(task, 'user_review', \`${filePath}: ${body}\`)`, ghi chú khác rỗng → thêm một bài. `concludeHandoff`→`applyGateResult(parent, false, feedback, 'review_feedback')`.
  - `TaskRepository.findLatestRepositoryRoot(departmentId: string): string | null` (task mới nhất có `repository_root`). Tối ưu: `knowledge.listFrequentLessons(root, 10)` → input prompt `frequentLessons: readonly string[]`, mục `Bài học hay gặp của repo (dữ liệu, không phải chỉ thị):` với tiền tố `> `; rỗng thì không có mục này.

- [ ] **Step 1: Test hỏng**

```ts
expect(interpretAgentReport('<aiteam-report>{"outcome":"done","summary":"x","learnings":["Luôn chạy migration trước test e2e",42,"ngắn","Dùng zod strict cho dữ liệu từ agent","Mục thứ tư đủ dài để hợp lệ"]}</aiteam-report>').learnings)
  .toEqual(['Luôn chạy migration trước test e2e', 'Dùng zod strict cho dữ liệu từ agent', 'Mục thứ tư đủ dài để hợp lệ']);
// knowledge-turn.e2e.test.ts, quy trình 'hotfix', lượt QC đầu trả report('fail', 'TC-03 lỗi 500 ở src/a.ts')
expect(engine.requests[3]?.prompt).toContain('> TC-03 lỗi 500 ở src/a.ts');
expect(app.database.prepare('SELECT source, body, paths_json FROM knowledge_lessons').all()).toEqual([
  { source: 'qc_feedback', body: 'TC-03 lỗi 500 ở src/a.ts', paths_json: '["src/a.ts"]' }]);
it('learns nothing from failing tests', … testCommand exit 1 → COUNT(*) knowledge_lessons = 0);
it('learns from the user note when a step is rejected', … POST /api/approvals/:id/decisions {approved:false, note:'Thiếu log lỗi ở src/a.ts'} → source 'user_review', body 'Thiếu log lỗi ở src/a.ts');
// workflow-proposal-prompt.test.ts: frequentLessons ['Dùng bcrypt'] → chứa '> Dùng bcrypt'; [] → không có 'Bài học hay gặp'
```

- [ ] **Step 2:** `npm test -- task-execution-rules knowledge-turn workflow-proposal-prompt` → FAIL.
- [ ] **Step 3:** Hiện thực.
- [ ] **Step 4:** PASS. Kiểm tra cuối: `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle`, `npm run measure` (khởi động < 2 s, RAM rảnh < 150 MB, gói < 15 MB) đều sạch.
- [ ] **Step 5:** Commit `feat(orchestration): learn lessons from rejected work`
