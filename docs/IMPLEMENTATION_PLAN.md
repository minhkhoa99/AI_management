# Kế hoạch thực hiện: AI Team (aiteam)

Nền tảng điều phối nhiều agent theo phòng ban, chạy hoàn toàn trên máy. Gõ `aiteam` là toàn bộ ứng dụng khởi động và mở trình duyệt.

Tài liệu liên quan: [mapping giao diện](UI_MAPPING.md) (màn hình → API → use case → giai đoạn), [giao diện mẫu](design/aiteam-ui.html).

## 1. Mục tiêu và giới hạn

**Phải có (theo giao diện đã thiết kế):**

- Phòng ban, sơ đồ phân cấp agent dạng cây, bật/tắt agent và cả phòng.
- Agent chọn bộ não: Claude Code (tài khoản đăng nhập), Codex (tài khoản đăng nhập), Custom API (OpenAI-compatible hoặc Anthropic).
- Quy trình phòng ban: thêm, sửa, xoá, nhân bản, đặt mặc định; các bước có điều kiện chuyển bước và hành vi khi không đạt.
- Task: tạo, sửa, xoá; giao xuống cấp dưới; thư mục làm việc; tài liệu QA; đích hoàn thành.
- Xoá task thì agent nhận tín hiệu huỷ, dừng và xác nhận.
- Theo dõi trực tiếp: trạng thái agent, terminal, cây thư mục, code, diff theo mốc, góp ý theo dòng, xem trước giao diện nhiều kích thước.
- Cài đặt kết nối Custom API.

**Ràng buộc kỹ thuật:**

- NestJS (backend), Next.js (giao diện), SQLite.
- Chỉ chạy trên `127.0.0.1`, một tiến trình Node duy nhất.
- Mục tiêu tài nguyên: RAM khi rảnh dưới 150 MB, khởi động dưới 2 giây, gói cài đặt dưới 15 MB (chưa tính Node). Đo bằng script ở Giai đoạn 5.

**Chưa làm (YAGNI):** nhiều người dùng, đăng nhập, triển khai lên server, chạy agent trên máy khác, phân tích dữ liệu nâng cao.

## 2. Quyết định kiến trúc

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Số tiến trình | 1 tiến trình Node: NestJS phục vụ cả API lẫn giao diện | Ít RAM nhất, không cần server Next.js khi chạy |
| Giao diện | Next.js `output: "export"` (HTML tĩnh), client components | Build một lần, lúc chạy chỉ là file tĩnh |
| HTTP | NestJS + Fastify adapter | Nhanh và nhẹ hơn Express |
| Cơ sở dữ liệu | SQLite qua `node:sqlite` có sẵn trong Node 22 LTS, chế độ WAL, prepared statement | Không cần module native, gói nhỏ, dễ đóng gói. Nếu gặp hạn chế thì thay bằng `better-sqlite3` ở tầng infrastructure, domain không đổi |
| Truy vấn | SQL viết tay trong repository, migration đánh số | KISS, không kéo ORM nặng |
| Hàng đợi task | Bảng `tasks` + bộ lập lịch trong tiến trình, giới hạn số agent chạy song song | Một máy, một tiến trình, không cần Redis |
| Thời gian thực | Server-Sent Events | Một chiều là đủ, nhẹ hơn WebSocket |
| Gọi Claude Code | `claude -p --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config` | Dùng tài khoản đã đăng nhập; không nạp hook/plugin/MCP cá nhân để agent chạy giống nhau trên mọi máy |
| Gọi Codex | `codex exec --json --ignore-user-config` (gọi thẳng CLI, chốt ở Giai đoạn 2 thay cho `@openai/codex-sdk`) | Dùng chung đăng nhập với Codex app, không thêm dependency |
| Custom API | `fetch` thuần tới OpenAI-compatible hoặc Anthropic Messages API | Không cần SDK riêng |
| Không gian làm việc | Mỗi task một git worktree + nhánh `agent/<taskId>`; mỗi mốc là một commit | Diff, hoàn tác, huỷ đều dựa trên git |
| Kiểm tra đầu vào | `zod` dùng chung cho backend và frontend | Một nguồn định nghĩa, nhẹ |
| Log | `pino`, JSON có `traceId` | Nhanh, có cấu trúc |
| Test | Vitest + SWC | Nhanh, ít bộ nhớ hơn Jest |
| Đóng gói | Bundle backend bằng esbuild thành một file; giao diện build tĩnh; phát hành npm package có lệnh `aiteam` | `npm i -g aiteam` rồi gõ `aiteam` |

### Luồng chạy một task

```
Bạn tạo task (UI) → TaskController → CreateTaskUseCase → TaskRepository (SQLite)
  → TaskScheduler chọn task "queued" khi còn chỗ
  → StartAgentSessionUseCase:
      WorkspacePort.prepareTaskWorkspace()      // git worktree
      GoalBuilder.buildCompletionGoal()         // QA hoặc mô tả + tiêu chí
      AgentEnginePort.startSession()            // Claude Code / Codex / Custom API
  → mỗi sự kiện của engine → TraceRecorder (lưu) → EventBus → SSE → UI
  → WorkflowEngine.evaluateStepGate() quyết định sang bước sau, quay lại hay dừng
Xoá task → CancelTaskUseCase → AbortController.abort() → engine dừng → sự kiện "cancelled"
```

## 3. Cấu trúc thư mục

```
AI_management/
├── apps/
│   ├── server/                 # NestJS
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── departments/
│   │       │   ├── agents/
│   │       │   ├── orchestration/
│   │       │   ├── providers/
│   │       │   └── tracing/
│   │       ├── shared/
│   │       │   ├── errors/
│   │       │   ├── logging/
│   │       │   ├── observability/
│   │       │   └── database/   # kết nối SQLite + migration, dùng chung
│   │       └── main.ts
│   └── web/                    # Next.js, xuất tĩnh
├── packages/
│   └── contracts/              # schema zod + kiểu dùng chung server/web
├── bin/aiteam.mjs              # lệnh khởi động
├── scripts/                    # build, đo hiệu năng
└── docs/
```

Mỗi module theo đúng khung:

```
modules/<tên>/
├── domain/          entities/, value-objects/, repositories/ (interface)
├── application/     use-cases/, ports/ (interface ra ngoài)
├── infrastructure/  persistence/ (SQLite), adapters/ (CLI, HTTP, git)
└── presentation/    controllers/, dto/
```

Quy tắc phụ thuộc: `presentation → application → domain`. `infrastructure` hiện thực interface của `domain` và `application`. `domain` không import NestJS, SQLite hay SDK nào.

### Phân chia trách nhiệm module

| Module | Domain | Use case chính | Infrastructure |
|---|---|---|---|
| departments | Department, Position (ghế trong sơ đồ), ReportingLine | createDepartment, assignAgentToPosition, toggleDepartment, buildOrgTree | SqliteDepartmentRepository |
| agents | Agent, ProviderChoice, PermissionPolicy | createAgent, changeAgentProvider, toggleAgent | SqliteAgentRepository |
| orchestration | Task, Delegation, Workflow, WorkflowStep, StepGate, CompletionGoal, Approval | createTask, updateTask, deleteTask, delegateTaskToSubordinate, startAgentSession, cancelTaskExecution, evaluateStepGate, reviewCheckpoint | SqliteTaskRepository, GitWorktreeWorkspace, TaskScheduler |
| providers | ProviderConnection, ApiFormat, ModelCatalog | saveConnection, testConnection, listModels, checkLocalEngines | ClaudeCodeCliEngine, CodexCliEngine, OpenAiCompatibleEngine, AnthropicApiEngine, SecretVault |
| tracing | Trace, TraceEvent, Checkpoint, LineComment | recordEvent, streamTaskEvents, listCheckpoints, addLineComment | SqliteTraceRepository, InProcessEventBus, SseStreamer |

**Port quan trọng nhất** nằm ở `orchestration/application/ports/agent-engine.port.ts`. Orchestration chỉ biết interface này, không biết Claude hay Codex.

```ts
export interface AgentEnginePort {
  startSession(request: AgentSessionRequest, signal: AbortSignal): AsyncIterable<AgentEngineEvent>;
}
```

Module providers đăng ký các engine theo token DI. `EngineResolver` chọn engine theo `agent.provider`. Muốn thêm engine mới chỉ cần thêm một class hiện thực port, không sửa orchestration.

## 4. Mô hình dữ liệu (SQLite)

| Bảng | Cột chính |
|---|---|
| departments | id, name, color, enabled, team_mode, created_at |
| positions | id, department_id, title, reports_to_position_id, agent_id, enabled |
| agents | id, name, role, provider, connection_id, model, access_level, network_access, enabled |
| provider_connections | id, name, format, base_url, encrypted_key, models_json, default_model |
| workflows | id, department_id, name, description, is_default, enforce, rules_json |
| workflow_steps | id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output |
| tasks | id, department_id, workflow_id, title, description, criteria, priority, assignee_agent_id, current_step_id, status, working_dir, session_ref, created_at, updated_at |
| task_attachments | id, task_id, file_name, size, content_path, detected_cases |
| task_events | id, task_id, trace_id, agent_id, kind, payload_json, created_at |
| checkpoints | id, task_id, sha, message, files_json, patch_path, created_at |
| line_comments | id, checkpoint_id, file_path, line, body, status |
| approvals | id, task_id, summary, detail_json, status, decided_at |

Trạng thái task: `queued → running → waiting_children → waiting_approval → succeeded | failed | cancelling → cancelled`.

**Giá trị liệt kê** được định nghĩa một lần trong `packages/contracts/src/enumerations.ts` (mảng `as const` + `z.enum`), SQL có `CHECK` tương ứng (migration `002_constrain_enumerations.sql`). Test chèn từng giá trị của contracts và so danh sách trong `CHECK` để phát hiện lệch.

| Cột | Giá trị |
|---|---|
| departments.team_mode | `orchestrator` \| `claude_code_teams` \| `codex_subagents` |
| agents.provider | `claude_code` \| `codex` \| `custom_api` (`custom_api` bắt buộc có `connection_id`) |
| agents.access_level | `read_only` \| `edit_workspace` (mặc định `read_only`) |
| agents.network_access | `0` \| `1` (mặc định `0`) |
| provider_connections.format | `openai` \| `anthropic` |
| tasks.priority | INTEGER `1` (cao) \| `2` (vừa) \| `3` (thấp) |
| tasks.status | `queued` \| `running` \| `waiting_children` \| `waiting_approval` \| `succeeded` \| `failed` \| `cancelling` \| `cancelled` |
| workflow_steps.gate | `auto` \| `tests_pass` \| `qc_pass` \| `lead_approval` \| `user_approval` |
| workflow_steps.on_fail | `retry` \| `return_to_step` \| `stop` |

Ràng buộc kết hợp ở `workflow_steps`: `return_to_step` bắt buộc có `fail_target_step_id`, các giá trị khác thì cột này phải `NULL`; `retry` thì `max_retries` từ 1 đến 5.

Patch lớn và tài liệu QA lưu thành file trong `~/.aiteam/data/`, bảng chỉ giữ đường dẫn, để cơ sở dữ liệu luôn gọn.

Giai đoạn 3 thêm cột `tasks.engine_snapshot_json` (bằng migration của Giai đoạn 3, không thêm sớm): cấu hình engine chụp lúc bắt đầu phiên, xem mục 5.11.

## 5. Quy tắc code áp dụng cụ thể

1. **Single Responsibility:** mỗi use case là một class với một phương thức công khai mang tên đúng việc làm, ví dụ `DelegateTaskToSubordinateUseCase.delegateTask()`.
2. **DRY:** logic chung như "ai là cấp dưới hợp lệ" hay "đích hoàn thành lấy từ đâu" nằm trong domain service, gọi lại ở mọi nơi.
3. **KISS / YAGNI:** không tạo base class chung cho mọi thứ; không thêm event sourcing, CQRS hay microservice.
4. **SOLID / DI:** use case nhận repository và port qua constructor; Nest module chỉ làm nhiệm vụ nối dây.
5. **Đặt tên:** cấm tên chung chung như `execute`, `run`, `handle`, `process`, `doWork`, `data`, `info`. Dùng tên mô tả hành vi: `startAgentSession`, `cancelTaskExecution`, `parseClaudeStreamLine`, `recordTraceEvent`, `buildCompletionGoal`. ESLint `id-denylist` chặn các tên bị cấm.
6. **Xử lý lỗi:**
   - Lớp gốc `AppError` có `code`, `retryable` và `cause`.
   - Lớp con: `ValidationError`, `NotFoundError`, `PermissionDeniedError`, `ConflictError`, `EngineUnavailableError` (retryable), `EngineAuthError` (không retry), `RateLimitedError` (retryable, có `retryAfterMs`).
   - `RetryPolicy` chỉ retry lỗi có `retryable = true`, backoff tăng dần, có giới hạn.
   - Filter toàn cục chuyển lỗi thành HTTP kèm `traceId`. Không có `catch` rỗng.
   - **Cô lập lỗi theo phiên:** mọi phiên agent chạy trong `AgentSessionSupervisor`. Mọi promise, stream và listener của phiên phải được `await` hoặc dẫn lỗi về supervisor. Lỗi trong phiên chuyển thành `failed` của task (hoặc thử lại nếu `retryable`), không lan ra tiến trình. ESLint bật `@typescript-eslint/no-floating-promises` và `no-misused-promises` ở mức error.
   - **Lỗi cấp tiến trình** (`unhandledRejection`, `uncaughtException`): log `fatal` kèm stack và `traceId`, ghi `~/.aiteam/logs/crash-<timestamp>.json`, huỷ mọi phiên đang chạy và lưu mốc (tối đa 5 giây), flush log, `exit(1)`, in hướng dẫn chạy lại `aiteam`. Không ghi log rồi chạy tiếp. Không thêm tiến trình giám sát.
   - **Phục hồi khi khởi động:** mỗi tiến trình CLI của phiên được ghi lại PID, tên và thời điểm bắt đầu. Khi khởi động: chỉ kill PID còn sống nếu đúng tên đã ghi (claude/codex) **và** thời điểm bắt đầu khớp (tránh giết nhầm tiến trình được hệ điều hành cấp lại PID); task `running` → `queued` (giữ `session_ref`), `cancelling` → `cancelled`.
7. **Testability:** domain và use case có unit test với repository trong bộ nhớ và engine giả. Mỗi engine có contract test chạy trên file JSONL ghi sẵn từ Claude Code và Codex thật. Mỗi bug fix đi kèm một regression test.
8. **Observability:** `AsyncLocalStorage` mang `traceId`, `taskId`, `agentId` xuyên suốt. Mọi log dạng JSON có các trường này. Mỗi task là một trace, mỗi bước là một span lưu trong `task_events`.
9. **Security by design:**
   - Chỉ lắng nghe `127.0.0.1`.
   - **Phiên đăng nhập bằng cookie:** mỗi lần chạy tạo token ngẫu nhiên (32 byte). `aiteam` mở `/?session=<token>`; server kiểm tra (so sánh constant-time), đặt cookie `aiteam_session` (`HttpOnly; SameSite=Strict; Path=/`) rồi redirect `303` về `/` để xoá token khỏi URL. Mọi API và SSE (`/api/*`) xác thực bằng cookie này; chỉ `/api/health` mở. File giao diện tĩnh không cần phiên (không chứa dữ liệu).
   - **Kiểm tra Host** cho mọi request: chỉ nhận `127.0.0.1:<port>` hoặc `localhost:<port>` (chống DNS rebinding).
   - **Kiểm tra Origin** cho `POST/PATCH/PUT/DELETE`: phải là `http://127.0.0.1:<port>` hoặc `http://localhost:<port>`; thiếu Origin cũng bị từ chối.
   - Token không bao giờ được ghi vào log hay lặp lại trong phản hồi lỗi.
   - Mọi DTO kiểm tra bằng zod.
   - API key của Custom API mã hoá AES-256-GCM, khoá lưu trong `~/.aiteam/secret.key` với quyền 600.
   - Thư mục làm việc phải nằm trong danh sách cho phép.
   - **Không tin dữ liệu từ agent:** đường dẫn agent trả về được kiểm tra không thoát khỏi worktree, nội dung hiển thị dạng text (không render HTML thô), preview giao diện chạy trong iframe sandbox.
   - Lệnh nguy hiểm bị chặn hoặc phải duyệt.
10. **Hiệu năng:**
    - Ghi sự kiện theo lô trong một transaction (mỗi 200 ms hoặc 100 sự kiện).
    - SSE gộp sự kiện trước khi đẩy.
    - Danh sách dài trong UI dùng ảo hoá.
    - Đọc file và diff theo yêu cầu, không nạp sẵn.
    - Giới hạn output terminal giữ trong bộ nhớ.
    - **Ngân sách bundle web (gzip, mỗi route):**
      - Chunk framework Next/React: không giới hạn tuyệt đối, nhưng có mốc đo lưu trong repo; CI lỗi nếu tăng quá 10% so với mốc. Mốc đo lưu ở `scripts/web-bundle-baseline.json`: 128,7 KB (Next 16.4.5, React 19.3.1; chunk `rootMainFiles` của build manifest, không tính polyfill `noModule`).
      - Code ứng dụng (mọi chunk không thuộc framework, kể cả zod và `packages/contracts`): ≤ 70 KB.
      - Tổng tải lần đầu (mọi JS mà HTML của route nạp): ≤ 230 KB.
      - Script đo và bước kiểm tra trong CI làm ở Giai đoạn 2. Chưa đổi sang `zod/mini`; web chỉ import schema mình thật sự dùng.

11. **Đổi cấu hình agent khi đang chạy task** (quy tắc chốt; hiện thực đầy đủ ở Giai đoạn 3):
    - Agent lưu cấu hình mới ngay và phát sự kiện domain `AgentConfigurationChanged { agentId, changes, reducesPermissions }`.
    - Phiên đang chạy dùng `engine_snapshot` chụp lúc bắt đầu phiên; thay đổi chỉ áp dụng từ phiên kế tiếp.
    - Đổi provider hoặc connection: bỏ `session_ref`, phiên mới bắt đầu với bản tóm tắt bàn giao. Chỉ đổi model trong cùng provider: giữ `session_ref`.
    - Giảm quyền (`edit_workspace` → `read_only`, tắt `network_access`, tắt agent): huỷ lượt hiện tại ngay (vẫn lưu mốc) rồi chạy lại với quyền mới.
    - `reducesPermissions` là hàm thuần trong domain module agents, có unit test; module orchestration chỉ dựa vào cờ này, không tự so sánh cấu hình.

## 6. Lệnh `aiteam`

```
npm i -g aiteam        # một lần
aiteam                 # mở ứng dụng: tạo ~/.aiteam, chạy migration, bật server, mở trình duyệt
aiteam doctor          # kiểm tra Node, git, claude, codex và trạng thái đăng nhập
aiteam --port 8000     # đổi cổng ưu tiên (hoặc biến môi trường AITEAM_PORT)
```

Cổng mặc định `7419`. Thứ tự ưu tiên: `--port` > `AITEAM_PORT` > `7419`. Nếu cổng đang bận, server thử các cổng kế tiếp (tối đa 20 cổng) và in URL của cổng thật sự dùng.

`bin/aiteam.mjs` chỉ làm bốn việc: kiểm tra phiên bản Node, chuẩn bị thư mục dữ liệu, nạp file server đã bundle, mở trình duyệt. Tắt bằng `Ctrl+C`: các task đang chạy được huỷ an toàn, mốc đã làm được lưu.

## 7. Lộ trình

Mỗi giai đoạn kết thúc bằng một bản chạy được, có test, được merge vào `master` qua pull request.

### Giai đoạn 0: Nền móng

- Monorepo npm workspaces, TypeScript strict, ESLint (gồm luật cấm tên chung chung), Prettier, Vitest.
- `shared/`: `AppError` và các lớp con, filter lỗi, logger pino có `traceId`, `AsyncLocalStorage`, kết nối SQLite và chạy migration.
- NestJS + Fastify phục vụ `/api/health` và giao diện Next.js tĩnh.
- `bin/aiteam.mjs` khởi động toàn bộ; `aiteam doctor`.
- GitHub Actions: lint, test, build.

**Hoàn thành khi:** `npm run build && node bin/aiteam.mjs` mở được trang trống có thanh điều hướng giống thiết kế, và `/api/health` trả về `ok`.

### Giai đoạn 1: Phòng ban và agent

- CRUD phòng ban, ghế, agent.
- Quy tắc phân cấp: không tạo vòng lặp, mỗi agent chỉ giao việc cho cấp dưới trực tiếp.
- Bật/tắt agent và cả phòng.
- UI: thanh bên, sơ đồ cây khối, chi tiết agent, form thêm thành viên, bảng agent ở Tổng quan.

**Hoàn thành khi:** dựng được phòng Dev như bản thiết kế qua giao diện, dữ liệu còn sau khi tắt mở lại.

### Giai đoạn 2: Bộ não (providers)

- `ClaudeCodeCliEngine`, `CodexCliEngine` chạy bằng tài khoản đăng nhập, chuyển luồng JSONL thành `AgentEngineEvent`.
- `OpenAiCompatibleEngine`, `AnthropicApiEngine` cho Custom API.
- Màn hình Cài đặt: kết nối Custom API (thêm, sửa, xoá, tải model, kiểm tra), thẻ Claude Code và Codex với nút chạy thử.
- Contract test cho từng engine bằng JSONL ghi sẵn.
- Sự kiện `AgentConfigurationChanged` và hàm xác định `reducesPermissions` trong module agents/providers, có test (mục 5.11). Chưa có phần phản ứng ở orchestration.
- Script đo bundle web theo route và bước kiểm tra ngân sách trong CI, kèm file mốc đo chunk framework (mục 5.10).

**Hoàn thành khi:** nút "Chạy thử" trên UI chạy một task nhỏ thật bằng Claude Code và Codex trên máy bạn.

### Giai đoạn 3: Điều phối

- Task CRUD; giao xuống cấp dưới; bộ lập lịch có giới hạn song song.
- Worktree cho mỗi task; tài liệu QA; `GoalBuilder` (QA hoặc mô tả + tiêu chí).
- Quy trình: CRUD, mẫu, điều kiện chuyển bước, thử lại, quay lại bước trước.
- Huỷ task: tín hiệu tới engine, chờ xác nhận, dọn worktree.
- Migration thêm `tasks.engine_snapshot_json`; chụp cấu hình engine khi bắt đầu phiên; phản ứng với `AgentConfigurationChanged` theo mục 5.11 (bỏ/giữ `session_ref`, huỷ lượt khi giảm quyền).
- Duyệt việc nhạy cảm.
- UI: màn hình Task (kanban, chi tiết, form), màn hình Quy trình.

**Hoàn thành khi:** một task đi đủ chuỗi Manager → PM → Dev → QC theo quy trình mẫu; xoá task giữa chừng thì agent dừng trong vòng 5 giây.

**Quyết định đã chốt (11/2026):**

- **Điều kiện chuyển bước:** `auto` sang bước sau khi agent báo xong. `tests_pass`: nền tảng chạy lệnh test khai báo cho task trong worktree, exit 0 là đạt. `qc_pass`: agent QC phụ trách bước trả kết luận pass/fail dạng JSON cuối lượt. `lead_approval`: mở phiên riêng cho cấp trên của người làm bước, trả pass/fail (người làm là trưởng phòng thì chuyển thành bạn duyệt). `user_approval`: tạo yêu cầu duyệt cho bạn.
- **Người làm bước:** `workflow_steps.owner_role` là vai trò (`AGENT_ROLES`) hoặc `user` (`STEP_OWNERS`, migration 006); bước của `user` chỉ dùng `user_approval`. Mỗi bước chọn agent đang bật có đúng vai trò trong phòng, ưu tiên cấp dưới trong chuỗi giao việc, ít việc nhất.
- **Giao việc:** một task đi qua các bước; "Giao xuống" là đổi người nhận sang cấp dưới trực tiếp và ghi vào chuỗi giao việc. Chưa có task con (`waiting_children` để sau).
- **Việc nhạy cảm:** agent kết thúc lượt bằng khối "cần duyệt" → task `waiting_approval`, phiên dừng; duyệt thì tiếp tục bằng `session_ref`, từ chối thì bước coi như không đạt. Lệnh nguy hiểm vẫn bị chặn như Giai đoạn 2. Không dùng MCP permission prompt.
- **Tài liệu QA:** mỗi file một request `PUT` thân nhị phân, không thêm `@fastify/multipart`. Chỉ đếm kịch bản cho `.md/.txt/.feature/.csv`; `.pdf/.docx/.xlsx` lưu và đưa đường dẫn để agent tự đọc.
- **Thư mục cho phép:** là các thư mục bạn đã chọn bằng hộp chọn thư mục của hệ điều hành; đường dẫn gõ tay phải nằm trong một thư mục đã chọn.
- **Worktree:** thư mục chưa là git repo (hoặc chưa có commit) thì nền tảng tự `git init` và tạo commit ban đầu; bỏ trống thư mục thì tạo thư mục riêng trong `~/.aiteam` rồi làm như trên. Huỷ/xoá task xoá worktree nhưng luôn giữ nhánh `agent/<taskId>`.
- **Chế độ team:** lưu lựa chọn; chỉ `orchestrator` chạy được (`SUPPORTED_TEAM_MODES`), hai chế độ còn lại hiển thị "chưa hỗ trợ".
- **Luật chung:** `noSkippingSteps`, `sensitiveActionsNeedApproval`, `allowAgentSubsteps`. "Ghi log mọi bước" không phải luật (luôn ghi); "dừng khi vượt ngân sách" làm cùng ngân sách ở Giai đoạn 5.
- Giai đoạn 3 chia 3 pull request: (A) quy trình + chế độ team, (B) task CRUD, thư mục, tài liệu QA, kanban, (C) chạy thật: worktree, lập lịch, điều kiện chuyển bước, giao việc, duyệt, huỷ, `engine_snapshot_json`.

### Giai đoạn 4: Theo dõi và review

- Lưu sự kiện theo lô, SSE theo task và theo phòng.
- Màn hình Theo dõi trực tiếp: ô trạng thái agent, terminal, cây thư mục, xem file, diff theo mốc (gộp và song song), góp ý theo dòng gửi về agent, hoàn tác file.
- Xem trước giao diện: nhúng dev server của worktree vào iframe sandbox, chọn thiết bị và kích thước.
- Chế độ xem tài liệu: hiển thị file Markdown agent đang viết.

**Hoàn thành khi:** theo dõi được một task code từ đầu đến cuối, gửi góp ý theo dòng và thấy agent sửa lại tạo mốc mới.

### Giai đoạn 5: Hoàn thiện và đóng gói

- Khôi phục sau khi tắt đột ngột: phần nền (kill tiến trình CLI mồ côi, `running` → `queued`, `cancelling` → `cancelled`) đã kéo lên làm trước Giai đoạn 3 (mục 5.6); ở đây chỉ còn tiếp tục phiên bằng `session_ref`.
- Giới hạn ngân sách theo task/phòng (token, số lượt).
- Script đo RAM, thời gian khởi động, kích thước gói; tối ưu tới khi đạt mục tiêu.
- Rà soát bảo mật theo mục 5.9.
- Phát hành npm package `aiteam`, README cài đặt.

**Hoàn thành khi:** máy mới chỉ cần `npm i -g aiteam && aiteam` là dùng được, và các số đo đạt mục tiêu ở mục 1.

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Định dạng JSONL của Claude Code / Codex thay đổi | Phần đọc luồng tách riêng, có contract test; đổi định dạng chỉ sửa một file |
| Hết hạn mức gói Claude / ChatGPT khi chạy nhiều agent | Giới hạn song song mặc định 2; nhận diện lỗi hạn mức thành `RateLimitedError` và tự xếp lại hàng |
| `node:sqlite` còn hạn chế | Repository qua interface; có thể đổi sang `better-sqlite3` mà không đụng domain |
| Agent ghi ra ngoài thư mục | Worktree riêng, danh sách thư mục cho phép, sandbox của Codex, chặn lệnh nguy hiểm của Claude Code |
| Gói cài quá nặng | Bundle bằng esbuild, chỉ giữ dependency chạy thật, kiểm tra kích thước trong CI |

## 9. Cách làm việc với repo

- Nhánh `master` luôn chạy được. Mỗi giai đoạn chia thành pull request nhỏ theo module.
- Commit theo Conventional Commits: `feat(orchestration): delegate task to subordinate`.
- CI phải xanh (lint, test, build) trước khi merge.
