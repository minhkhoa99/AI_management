# Kế hoạch mapping giao diện

Tài liệu nối từng phần của giao diện mẫu (`docs/design/aiteam-ui.html`) với route Next.js, component, API, use case backend và giai đoạn thực hiện trong `IMPLEMENTATION_PLAN.md`. Mục tiêu: mỗi nút trên bản thiết kế đều biết nó gọi gì và ai chịu trách nhiệm.

## 1. Nguyên tắc chung cho giao diện

- **Xuất tĩnh:** Next.js dùng `output: "export"`, mọi trang là client component. Không có SSR, không có server Next khi chạy. NestJS phục vụ các file tĩnh.
- **Route và trạng thái:** route cố định cho từng màn hình. Lựa chọn phụ (phòng, agent, tab, task đang mở) nằm trong query string để bookmark được và không cần route động: `/org?dept=dev`, `/monitor?agent=m3&tab=diff`.
- **Lấy dữ liệu:** một hook nhỏ `useApiQuery(key, loader)` có cache theo key và tự làm mới khi có sự kiện SSE liên quan. Không thêm thư viện quản lý state (YAGNI).
- **Thời gian thực:**
  - `useEventStream(url)` mở một kết nối SSE cho mỗi màn hình đang xem.
  - Sự kiện được gộp trong 200 ms trước khi cập nhật UI.
  - Danh sách dài (luồng hoạt động, dòng diff, terminal) dùng cuộn ảo.
- **Kiểu dáng:** Tailwind với token màu lấy đúng từ bản thiết kế (nền `#080D1A`, bề mặt `#0E172B`, viền `#1E2A47`, chính `#3B82F6`, hành động `#F97316`). Font Space Grotesk cho tiêu đề, Be Vietnam Pro cho nội dung.
- **Kiểm tra đầu vào:** form dùng chung schema zod với backend (`packages/contracts`). Lỗi từ API hiển thị kèm `traceId` để tra log.
- **Không tin dữ liệu agent:**
  - Nội dung agent (tin nhắn, code, tài liệu, output terminal) luôn hiển thị dạng text, không dùng `dangerouslySetInnerHTML`.
  - Markdown render bằng renderer chỉ cho phép thẻ an toàn.
  - Bản xem trước giao diện chạy trong `<iframe sandbox>`.
- **Chi phí:** agent dùng tài khoản đăng nhập (Claude Code, Codex) hiển thị token và số lượt. Tiền chỉ hiển thị cho Custom API. Đây là điểm khác với bản thiết kế, cần sửa khi code.

## 2. Cấu trúc thư mục giao diện

```
apps/web/src/
├── app/
│   ├── layout.tsx               # Sidebar + Topbar dùng chung
│   ├── page.tsx                 # Tổng quan
│   ├── org/page.tsx             # Sơ đồ tổ chức
│   ├── workflows/page.tsx       # Quy trình
│   ├── tasks/page.tsx           # Task
│   ├── monitor/page.tsx         # Theo dõi trực tiếp
│   └── settings/page.tsx        # Cài đặt API
├── features/
│   ├── overview/      components/, hooks/
│   ├── org/           components/, hooks/
│   ├── workflows/     components/, hooks/
│   ├── tasks/         components/, hooks/
│   ├── monitor/       components/, hooks/   # file tree, diff, terminal, preview…
│   └── settings/      components/, hooks/
└── shared/
    ├── api/           api-client.ts, use-api-query.ts, use-event-stream.ts
    └── ui/            component dùng chung (mục 3)
```

## 3. Component dùng chung

| Component | Dùng ở | Ghi chú |
|---|---|---|
| `AppSidebar` | mọi trang | điều hướng, danh sách phòng ban, đồng hồ ngân sách/hạn mức |
| `AppTopbar` | mọi trang | tiêu đề, ô tìm kiếm toàn cục, chuông duyệt, nút hành động chính |
| `StatusPill` | tree, bảng, ô agent | nhận `AgentStatus`, luôn có chữ, không chỉ màu |
| `ProviderBadge` | tree, bảng, task | Claude Code / Codex / Custom API (+ tên kết nối) |
| `ToggleSwitch` | agent, phòng, luật, engine | `button` có `aria-pressed` |
| `AgentAvatar` | khắp nơi | chữ viết tắt, viền theo trạng thái |
| `KpiCard`, `MiniBars` | Tổng quan | thanh vẽ bằng CSS, không dùng thư viện chart |
| `HourlyBarChart`, `CostDonut` | Tổng quan | CSS thuần (`conic-gradient`), có `aria-label` mô tả số liệu |
| `PillFilter` | nhiều trang | nhóm nút lọc có `aria-pressed` |
| `InlinePanel`, `ConfirmPanel` | form, xoá | khung nhúng trong trang thay cho modal |
| `StatusNotice` | sau mỗi thao tác | `role="status"` hoặc `role="alert"` |
| `TerminalView`, `FileTree`, `CodeView`, `DiffView` | Theo dõi, Task | dùng chung giữa các loại agent |

## 4. Mapping theo màn hình

Ký hiệu cột GĐ: giai đoạn thực hiện trong `IMPLEMENTATION_PLAN.md`.

### 4.1 Khung chung (sidebar + topbar)

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Danh sách phòng ban + số agent | `GET /api/departments` | `ListDepartmentsUseCase` · departments | 1 |
| Ô ngân sách / hạn mức hôm nay | `GET /api/overview/usage-today` | `SummarizeUsageTodayUseCase` · tracing | 4 |
| Tìm agent hoặc task | lọc phía client trên dữ liệu đã tải; nếu nhiều thì `GET /api/search?q=` | `SearchWorkspaceUseCase` · orchestration | 3 |
| Chuông + số yêu cầu chờ duyệt | `GET /api/approvals?status=pending`, SSE `approval.*` | `ListPendingApprovalsUseCase` · orchestration | 3 |
| Nút "Chạy mô phỏng" | bỏ khi làm thật, thay bằng "Tạo task" | — | — |

### 4.2 Tổng quan `/`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| 4 thẻ KPI (task xong, agent hoạt động, tỉ lệ qua QC, token/chi phí) | `GET /api/overview/metrics` | `CalculateOverviewMetricsUseCase` · tracing | 4 |
| Biểu đồ task theo giờ | `GET /api/overview/throughput?range=today` | `AggregateHourlyThroughputUseCase` · tracing | 4 |
| Chi phí theo bộ não | `GET /api/overview/usage-by-provider` | `AggregateUsageByProviderUseCase` · tracing | 4 |
| Bảng agent: lọc phòng, tìm, chọn nhiều (cột task xong, tỉ lệ thành công, chi phí có ở GĐ 3–4) | `GET /api/agents?departmentId=&q=` | `ListAgentsUseCase` · agents | 1 |
| Bật/tắt một agent | `PATCH /api/agents/:id/enabled` | `ToggleAgentUseCase` · agents | 1 |
| Bật/tắt hàng loạt | `PATCH /api/agents/enabled` `{ ids, enabled }` | `ToggleAgentsInBulkUseCase` · agents | 1 |
| Bấm tên agent → mở sơ đồ | điều hướng `/org?dept=…&agent=…` | — | 1 |
| Chờ bạn duyệt: Duyệt / Từ chối | `POST /api/approvals/:id/decision` `{ approved }` | `DecideApprovalUseCase` · orchestration | 3 |
| Hoạt động gần đây | `GET /api/activity?limit=6`, SSE `/api/stream/workspace` | `ListRecentActivityUseCase` · tracing | 4 |
| Thẻ phòng ban (trưởng phòng, số agent, avatar thành viên; task mở và chi phí có ở GĐ 3–4) | `GET /api/departments/summary` | `SummarizeDepartmentsUseCase` · departments | 1 |

### 4.3 Sơ đồ tổ chức `/org?dept=&agent=`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Tab chọn phòng | `GET /api/departments` | đã có ở 4.1 | 1 |
| Bật/tắt cả phòng | `PATCH /api/departments/:id/enabled` | `ToggleDepartmentUseCase` · departments | 1 |
| Chế độ team (Orchestrator / Claude Code teams / Codex subagents) | `PATCH /api/departments/:id/team-mode` | `ChangeTeamModeUseCase` · departments | 3 |
| Cây phân cấp dạng khối | `GET /api/departments/:id/org-tree` | `BuildOrgTreeUseCase` · departments | 1 |
| Nút + trên khối (thêm cấp dưới) | mở form với `reportsTo` điền sẵn | — | 1 |
| Form thêm thành viên | `POST /api/departments/:id/members` `{ name, role, provider, connectionId?, model?, reportsToPositionId }` | `AddDepartmentMemberUseCase` (tạo agent + ghế trong một transaction) · departments + agents | 1 |
| Thêm / sửa / xoá phòng | `POST /api/departments` `{ name, color }`, `PATCH /api/departments/:id` `{ name?, color? }`, `DELETE /api/departments/:id` (chặn khi còn thành viên) | `CreateDepartmentUseCase`, `UpdateDepartmentUseCase`, `DeleteDepartmentUseCase` · departments | 1 |
| Chi tiết agent: thông tin, cấp dưới | `GET /api/agents/:id` | `GetAgentDetailUseCase` · agents | 1 |
| Chi tiết agent: sửa tên, vai trò | `PATCH /api/departments/:id/members/:positionId` `{ name?, role? }` | `UpdateDepartmentMemberUseCase` · departments | 1 |
| Chi tiết agent: đổi cấp trên | `PUT /api/departments/:id/members/:positionId/reports-to` `{ reportsToPositionId }` | `ChangeReportingLineUseCase` (chặn vòng lặp) · departments | 1 |
| Chi tiết agent: xoá khỏi phòng | `DELETE /api/departments/:id/members/:positionId` (chặn khi còn cấp dưới) | `RemoveDepartmentMemberUseCase` (xoá ghế + agent) · departments | 1 |
| Chi tiết agent: đổi bộ não và quyền (provider, kết nối, model, quyền trong thư mục, mạng) | `PATCH /api/agents/:id/configuration` (phát `AgentConfigurationChanged`) | `ChangeAgentConfigurationUseCase` · agents | 2 |
| Cấu hình Custom API của agent (kết nối + model) | `GET /api/provider-connections`, `PATCH /api/agents/:id/configuration` | như trên · agents + providers | 2 |
| "Xem trực tiếp agent này" | điều hướng `/monitor?agent=…` | — | 4 |

Quy tắc domain cần test: không tạo vòng lặp báo cáo; một ghế chỉ có một agent; tắt phòng thì task mới bị từ chối.

Đã chốt ở Giai đoạn 1: mỗi thành viên = một ghế + một agent (tạo/xoá cùng nhau); mỗi phòng đúng một trưởng phòng (gốc), người khác báo cáo cho thành viên cùng phòng; vai trò là danh sách cố định `AGENT_ROLES`; xoá agent còn cấp dưới hoặc phòng còn thành viên đều bị chặn; tắt phòng giữ nguyên cờ bật/tắt riêng của từng agent. Custom API chỉ chọn được khi có kết nối (Giai đoạn 2).

### 4.4 Quy trình `/workflows?dept=&workflow=`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Danh sách quy trình của phòng | `GET /api/departments/:id/workflows` | `ListWorkflowsUseCase` · orchestration | 3 |
| Tạo quy trình mới (trống / mẫu / sao chép) | `POST /api/departments/:id/workflows` `{ name, description, source }` | `CreateWorkflowUseCase` · orchestration | 3 |
| Sửa tên, mô tả | `PATCH /api/workflows/:id` | `RenameWorkflowUseCase` · orchestration | 3 |
| Nhân bản | `POST /api/workflows/:id/duplicates` | `DuplicateWorkflowUseCase` · orchestration | 3 |
| Đặt mặc định | `PUT /api/departments/:id/default-workflow` `{ workflowId }` | `SetDefaultWorkflowUseCase` · orchestration | 3 |
| Xoá (chặn khi là quy trình cuối cùng, chuyển task sang mặc định) | `DELETE /api/workflows/:id` | `DeleteWorkflowUseCase` · orchestration | 3 |
| Mẫu quy trình | `GET /api/workflow-templates` | hằng số trong domain, không lưu DB | 3 |
| Chuỗi bước + sửa bước + đổi thứ tự + thêm/xoá bước | `PUT /api/workflows/:id/steps` (gửi cả danh sách khi bấm Lưu) | `ReplaceWorkflowStepsUseCase` (kiểm tra bước quay lại phải đứng trước) · orchestration | 3 |
| Luật chung, bắt buộc tuân theo | `PATCH /api/workflows/:id/rules` | `UpdateWorkflowRulesUseCase` · orchestration | 3 |
| Nhãn "T-142 đang ở bước này" | lấy từ `GET /api/tasks?workflowId=` | đã có ở 4.5 | 3 |

Đã chốt ở Giai đoạn 3: người phụ trách bước là vai trò hoặc "Bạn" (`STEP_OWNERS`); bước quay lại được gửi bằng chỉ số bước đứng trước (`returnToStepIndex`), bước giữ `id` khi sửa; bật/tắt "Bắt buộc tuân theo" và luật chung lưu ngay, chuỗi bước chỉ lưu khi bấm "Lưu quy trình" (nút này nằm trên khung các bước thay vì thanh trên cùng). Luật "Ghi log mọi bước" bỏ (luôn ghi), "Dừng khi vượt ngân sách" để Giai đoạn 5. Chế độ team: `PATCH /api/departments/:id/team-mode`, chỉ Orchestrator chọn được.

### 4.5 Task `/tasks?dept=&task=`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Kanban 4 cột, lọc phòng, tìm | `GET /api/tasks?departmentId=` | `ListTasksUseCase` · orchestration | 3 |
| Chuyển giai đoạn bằng mũi tên | `PATCH /api/tasks/:id/stage` | `MoveTaskStageUseCase` (tôn trọng quy trình nếu bắt buộc) · orchestration | 3 |
| Tạo task: tiêu đề, mô tả, tiêu chí, phòng, người nhận, quy trình, ưu tiên | `POST /api/tasks` | `CreateTaskUseCase` · orchestration | 3 |
| Chọn thư mục làm việc + thư mục gần đây | `GET /api/workspace/recent-dirs`, `POST /api/workspace/dir-validation` | `ValidateWorkingDirectoryUseCase` (phải nằm trong danh sách cho phép) · orchestration | 3 |
| Nút "Chọn thư mục" | ứng dụng chạy local nên backend mở hộp chọn thư mục: `POST /api/workspace/dir-picker` (macOS `osascript`, Windows PowerShell, Linux `zenity`) | `PickLocalDirectoryUseCase` · orchestration (adapter theo hệ điều hành) | 3 |
| Tải tài liệu QA | `POST /api/tasks/:id/attachments` (multipart, giới hạn kích thước và loại file) | `AttachQaDocumentUseCase` + `CountTestCasesService` · orchestration | 3 |
| Khung "Đích hoàn thành" | tính ở client bằng hàm dùng chung trong `packages/contracts`; backend tính lại khi giao task | `CompletionGoal` (value object) | 3 |
| Sửa task | `PATCH /api/tasks/:id` | `UpdateTaskUseCase` (đổi người nhận → gửi tín hiệu dừng cho agent cũ) · orchestration | 3 |
| Xoá task + trạng thái "chờ agent dừng" | `DELETE /api/tasks/:id` trả về `202`, task chuyển `cancelling`; SSE `task.cancelled` khi agent xác nhận | `CancelTaskExecutionUseCase` → `AgentEnginePort` abort → `CleanupTaskWorkspaceUseCase` · orchestration | 3 |
| Chi tiết task: chuỗi giao việc | `GET /api/tasks/:id` (kèm `delegationChain`) | `GetTaskDetailUseCase` · orchestration | 3 |
| Giao xuống cấp dưới | `POST /api/tasks/:id/delegations` `{ toAgentId }` | `DelegateTaskToSubordinateUseCase` · orchestration | 3 |
| "Để Manager tự giao" | `POST /api/tasks/:id/auto-delegations` | `AutoDelegateByWorkloadUseCase` · orchestration | 3 |
| Nhật ký task | `GET /api/tasks/:id/events?limit=`, SSE `/api/stream/tasks/:id` | `ListTaskEventsUseCase` · tracing | 4 |
| "Xem thay đổi code" | điều hướng `/monitor?agent=…&task=…&tab=diff` | — | 4 |

Đã chốt ở Giai đoạn 3 (phần B): mã task dạng `T-<n>` (`tasks.sequence_number`, migration 007); tài liệu QA tải lên bằng `PUT /api/tasks/:id/attachments?fileName=` thân nhị phân, xoá bằng `DELETE /api/tasks/:id/attachments/:attachmentId`; `DELETE /api/tasks/:id` trả `202 { taskId, outcome }` (`deleted` ngay khi task chưa chạy hoặc đã xong, `cancelling` khi phải dừng agent, có ở phần C); task có thêm "Lệnh kiểm thử" cho điều kiện `tests_pass`. Phần C: mũi tên trên thẻ chuyển bước (lùi luôn được; tiến khi quy trình tắt luật "Không được bỏ qua bước"), `POST /api/tasks/:id/retries` ("Chạy lại"), nhật ký task cơ bản `GET /api/tasks/:id/events` (làm mới 2 giây khi task đang chạy; SSE ở Giai đoạn 4), chuông duyệt `GET /api/approvals?status=pending` + `POST /api/approvals/:id/decision`, ô tìm kiếm trên thanh trên cùng lọc bảng task theo tiêu đề, mã, người nhận. Thư mục cho phép chỉ thêm được qua hộp chọn thư mục (`POST /api/workspace/dir-picker`); `PATCH /api/settings` chỉ bỏ bớt thư mục và đổi số agent song song. Xoá phòng bị chặn khi còn task; xoá thành viên bị chặn khi còn task chưa xong.

### 4.6 Theo dõi trực tiếp `/monitor?dept=&agent=&tab=`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Lọc phòng + bộ đếm trạng thái | `GET /api/monitor/agents?departmentId=` | `ListAgentTilesUseCase` · orchestration | 4 |
| Ô agent (task, loại việc, hành động gần nhất, tiến độ bước) | như trên + SSE `/api/stream/departments/:id` | như trên | 4 |
| Đầu khung: thông tin agent, task, thư mục | lấy từ ô agent (không có endpoint riêng); `?task=` ghim một task (`GET /api/tasks/:id`) | — | 4 |
| Tạm dừng / Tiếp tục | `POST /api/tasks/:id/pause`, `POST /api/tasks/:id/resume` (theo task, không theo agent) | `PauseTaskUseCase` (lưu mốc, trạng thái `paused`), `ResumeTaskUseCase` (tiếp tục phiên qua `sessionRef`) · orchestration | 4 |
| Tab Code & thư mục: cây thư mục | `GET /api/tasks/:id/workspace/tree` | `ListWorkspaceTreeUseCase` (bỏ `node_modules`, `.git`; chặn đường dẫn ra ngoài worktree) · orchestration | 4 |
| Xem file | `GET /api/tasks/:id/workspace/file?path=` | `ReadWorkspaceFileUseCase` (giới hạn kích thước) · orchestration | 4 |
| Dòng code đang viết dần | SSE `/api/stream/tasks/:id`, sự kiện `file_change` (đường dẫn tương đối worktree) → tải lại file đang mở | — | 4 |
| Tab Thay đổi (diff): mốc, file, gộp/song song | `GET /api/tasks/:id/checkpoints`, `GET /api/checkpoints/:id/diff`, `GET /api/tasks/:id/diff` (từ lúc task bắt đầu, `tasks.base_sha`) | `ListCheckpointsUseCase`, `BuildCheckpointDiffUseCase`, `BuildTaskDiffUseCase` · orchestration | 4 |
| Góp ý theo dòng | `GET`/`POST /api/checkpoints/:id/line-comments` | `AddLineCommentUseCase`, `ListLineCommentsUseCase` (trạng thái `open` → `sent` → `resolved`) · orchestration | 4 |
| Duyệt thay đổi / Yêu cầu sửa | `POST /api/tasks/:id/reviews` `{ decision }` | `SubmitCodeReviewUseCase` (duyệt → quyết định yêu cầu duyệt đang chờ; yêu cầu sửa → trả task về bước đã tạo mốc, cùng agent, kèm góp ý) · orchestration | 4 |
| Hoàn tác file / khôi phục | `POST /api/tasks/:id/workspace/file-reverts` `{ path }` | `RevertWorkspaceFileUseCase` (`git checkout <base> -- path`) · orchestration | 4 |
| Tab Terminal | `GET /api/tasks/:id/events` (lọc `command`, kèm output) + SSE task | — | 4 |
| Tab Hoạt động | SSE + `GET /api/agents/:id/events` | `ListAgentEventsUseCase` · tracing | 4 |
| Tab Giao diện: chọn thiết bị, xoay, thu phóng | `POST /api/tasks/:id/preview` `{ restart }` khởi động hoặc gia hạn (trang gọi lại mỗi 10 giây, 1,5 giây khi đang khởi động), `DELETE /api/tasks/:id/preview` khi rời tab; trả `{ state, url, port, message, output }`; danh sách thiết bị là hằng số ở client | `StartTaskPreviewUseCase`, `StopTaskPreviewUseCase`, `TaskPreviewRegistry` (lệnh “Lệnh chạy giao diện” của task, cổng trống thay `{port}`, chỉ loopback) · orchestration | 4 |
| Khung "Agent tự kiểm tra responsive" | `GET /api/tasks/:id/responsive-report` | `CaptureResponsiveReportUseCase` (Playwright, chạy khi được yêu cầu) | 5 |
| Tab Tài liệu | file `.md` trong cây thư mục; render Markdown tự viết (chỉ React element, không HTML) | `ReadWorkspaceFileUseCase` | 4 |
| Tab Kết quả kiểm thử | đọc báo cáo test dạng JSON (pytest-json, JUnit) agent ghi ra | `ParseTestReportUseCase` · tracing | 5 |
| Tab Thiết kế | xem file ảnh/SVG/HTML agent xuất ra trong worktree | `ReadWorkspaceFileUseCase` | 5 |
| Tab Kế hoạch (Manager) | `GET /api/agents/:id/delegated-tasks` | `ListDelegatedTasksUseCase` · orchestration | 4 |
| Tab Hội thoại, Bảng dữ liệu | chưa làm, chờ có agent dùng công cụ ngoài (YAGNI) | — | sau |

Loại việc của agent (code, giao diện, tài liệu, kiểm thử…) không cần lưu cứng. Backend suy ra từ vai trò agent và loại file thay đổi trong task, rồi trả về trường `workType` để giao diện chọn tab mặc định.

Ô agent hiện task gấp nhất đang mở (chạy > đang huỷ > chờ duyệt > tạm dừng > chờ chạy); không còn task mở thì hiện task xong gần nhất (trạng thái "Rảnh") để vẫn xem và duyệt được thay đổi.

### 4.7 Cài đặt `/settings`

| Thành phần UI | API | Use case / module | GĐ |
|---|---|---|---|
| Thẻ Claude Code / Codex: đã cài, tài khoản đăng nhập | `GET /api/local-engines` | `ListLocalEnginesUseCase` (`claude --version`, `claude auth status`, `codex --version`, `codex login status`) · providers | 2 |
| Model mặc định, chặn lệnh nguy hiểm, cho phép mạng (giới hạn trên; quyền thật do từng agent quyết) | `PATCH /api/local-engines/:engine/settings` | `UpdateLocalEngineSettingsUseCase` · providers | 2 |
| Chạy thử trên máy | `POST /api/local-engines/:engine/test-runs`, SSE `GET /api/engine-test-runs/:testRunId/events`, huỷ `POST /api/engine-test-runs/:testRunId/cancellation` | `StartLocalEngineTestRunUseCase` (thư mục tạm, chỉ đọc, không mạng), `WatchEngineTestRunUseCase`, `CancelEngineTestRunUseCase` · providers | 2 |
| Chạy thử một kết nối Custom API | `POST /api/provider-connections/:id/test-runs` `{ model }` + cùng SSE | `StartConnectionTestRunUseCase` · providers | 2 |
| Hướng dẫn cài | nội dung tĩnh | — | 2 |
| Danh sách kết nối Custom API | `GET /api/provider-connections` (key luôn che) | `ListProviderConnectionsUseCase` · providers | 2 |
| Thêm / sửa kết nối | `POST`, `PATCH /api/provider-connections/:id` | `SaveProviderConnectionUseCase` (mã hoá key bằng `SecretVault`) · providers | 2 |
| Tải danh sách model | `POST /api/provider-connections/model-discovery` `{ format, baseUrl, key? }` | `DiscoverModelsUseCase` (`GET /models` hoặc `/v1/models`) · providers | 2 |
| Kiểm tra kết nối | `POST /api/provider-connections/:id/checks` | `CheckProviderConnectionUseCase` · providers | 2 |
| Xoá (chặn khi còn agent dùng) | `DELETE /api/provider-connections/:id` | `DeleteProviderConnectionUseCase` · providers | 2 |
| Khung "Cách nền tảng gọi API" | dựng ở client từ dữ liệu form | — | 2 |
| Thư mục cho phép, số agent chạy song song | `GET/PATCH /api/settings` | `UpdateWorkspaceSettingsUseCase` · orchestration | 3 |

## 5. Luồng SSE

| Kênh | Sự kiện | Màn hình nghe |
|---|---|---|
| `/api/stream/workspace` | `activity`, `approval.created`, `approval.decided`, `usage` | sidebar, topbar, Tổng quan |
| `/api/stream/departments/:id` | `agent.status`, `task.stage`, `task.created`, `task.cancelled` | Sơ đồ, Task, Theo dõi (lưới ô) |
| `/api/stream/tasks/:id` | `message`, `command`, `file.change`, `checkpoint`, `todo`, `approval`, `done`, `error`, `cancelled` | chi tiết task, khung làm việc agent |

Mỗi sự kiện có `traceId`, `taskId`, `agentId`, `ts`. Server gộp sự kiện 200 ms một lần và gửi `id` tăng dần, để khi mất kết nối client dùng `Last-Event-ID` lấy lại phần thiếu.

## 6. Thứ tự làm giao diện theo giai đoạn

| GĐ | Màn hình / phần làm | Dữ liệu |
|---|---|---|
| 0 | Layout, sidebar, topbar, token màu, component dùng chung cơ bản, `api-client`, `useApiQuery`, `useEventStream` | `/api/health` |
| 1 | Sơ đồ tổ chức, bảng agent và thẻ phòng ở Tổng quan | departments, agents |
| 2 | Cài đặt (local engines + Custom API), đổi bộ não trong chi tiết agent | providers |
| 3 | Task (kanban, form, QA, chi tiết, giao việc, xoá), Quy trình, chờ duyệt | orchestration |
| 4 | Theo dõi trực tiếp (ô agent, code, diff, góp ý, terminal, giao diện, tài liệu), KPI và biểu đồ Tổng quan, nhật ký task | tracing |
| 5 | Kiểm tra responsive tự động, kết quả kiểm thử, xem thiết kế, tối ưu cuộn ảo và kích thước bundle | tracing, orchestration |

## 7. Tiêu chí nghiệm thu giao diện

- Mỗi màn hình khớp bố cục và màu với `docs/design/aiteam-ui.html`; khác biệt có chủ đích được ghi trong pull request.
- Chạy được ở chiều rộng 360 px: menu xếp chồng, bảng cuộn ngang trong khung.
- Mọi nút là `<button>` hoặc `<a>` thật, có `aria-label` khi chỉ có icon; điều khiển được bằng bàn phím.
- Không có dữ liệu giả trong bản build; trạng thái trống có hướng dẫn hành động tiếp theo.
- Ngân sách bundle mỗi route (gzip), xem mục 5.10 của `IMPLEMENTATION_PLAN.md`: framework Next/React theo mốc đo (CI lỗi nếu tăng > 10%), code ứng dụng ≤ 70 KB, tổng tải lần đầu ≤ 230 KB. CI kiểm tra từ Giai đoạn 2.
