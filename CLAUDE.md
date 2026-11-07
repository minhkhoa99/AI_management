# AI Team (aiteam) — quy tắc cho mọi phiên làm việc

Nền tảng điều phối nhiều agent AI theo phòng ban, chạy hoàn toàn trên máy (localhost).
Tài liệu gốc: `docs/IMPLEMENTATION_PLAN.md` (kiến trúc, dữ liệu, lộ trình), `docs/UI_MAPPING.md`
(màn hình → API → use case), `docs/design/aiteam-ui.html` (giao diện mẫu). Đọc trước khi code.

## Stack (không thêm thư viện ngoài danh sách nếu chưa hỏi chủ dự án)

- Backend: NestJS + Fastify adapter. Frontend: Next.js `output: "export"` (HTML tĩnh, client components).
- SQLite qua `node:sqlite`, SQL viết tay trong repository, migration đánh số. Không ORM.
- `zod` (schema dùng chung trong `packages/contracts`), `pino` (log JSON), Vitest + SWC, esbuild.
- Styling: CSS thuần + CSS custom properties (token màu) + CSS Modules. Không Tailwind.
- Font: `next/font/google` (self-host lúc build): Space Grotesk (tiêu đề), Be Vietnam Pro (nội dung).
- Node: chỉ các bản LTS đã vá bảo mật mới nhất. Tối thiểu hiện tại: 22.23.4 / 24.22.1 / 26.12.1
  (bản vá 10/2026, CVE-2026-111497). Bảng tối thiểu nằm ở `bin/node-version-policy.mjs`; cập nhật khi
  Node ra bản vá bảo mật mới.
- Một tiến trình Node duy nhất, chỉ lắng nghe `127.0.0.1`. Cổng mặc định `7419`
  (`--port` > `AITEAM_PORT` > 7419; cổng bận thì tự thử cổng trống kế tiếp, in URL thật).

## Bảo mật phiên (bắt buộc giữ nguyên)

- `aiteam` mở `/?session=<token>` → server đổi token lấy cookie `aiteam_session`
  (`HttpOnly; SameSite=Strict; Path=/`) rồi redirect `303` về `/`. Không dùng header token.
- Mọi `/api/*` (REST và SSE) xác thực bằng cookie; chỉ `/api/health` mở.
- Mọi request: Host phải là `127.0.0.1:<port>` (không nhận `localhost`) và đường dẫn dạng `/...`
  (từ chối URL tuyệt đối `GET http://host/api/...`, router vẫn định tuyến được nó).
- `POST/PATCH/PUT/DELETE`: Origin phải là `http://127.0.0.1:<port>`.
- Cookie không phân biệt cổng: bản xem trước (server do agent viết) mở ở `localhost`, khác
  site với giao diện nên không nhận cookie. Không bao giờ đưa giao diện lên `localhost`.
- Mọi phản hồi có `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
- Code ở `apps/server/src/shared/security/`. Không ghi token vào log, không lặp lại query string trong lỗi.

## Giá trị liệt kê

- Định nghĩa một lần trong `packages/contracts/src/enumerations.ts` (mảng `as const` + `z.enum`).
- SQL `CHECK` phải liệt kê đúng các giá trị đó; đổi danh sách = migration mới + sửa contracts cùng lúc.
  `enumerations.test.ts` chèn từng giá trị và so danh sách trong `CHECK` để bắt lệch.
- Migration đã phát hành không bao giờ sửa; thêm file mới (`NNN_ten.sql` hoặc `.ts`). Migration dựng
  lại bảng đặt `rebuildsTables: true` (runner tắt foreign keys quanh transaction, chạy
  `foreign_key_check` trước khi commit).

## Kiến trúc mỗi module (`apps/server/src/modules/<tên>/`)

```
domain/          entities/, value-objects/, repositories/ (interface)
application/     use-cases/, ports/ (interface ra ngoài)
infrastructure/  persistence/ (SQLite), adapters/ (CLI, HTTP, git)
presentation/    controllers/, dto/
```

- Phụ thuộc: `presentation → application → domain`; `infrastructure` hiện thực interface của domain/application.
- `domain` không import NestJS, `node:sqlite` hay SDK của LLM provider.
- Nest module chỉ nối dây (DI). Mỗi use case một class, một phương thức công khai tên rõ nghĩa
  (`DelegateTaskToSubordinateUseCase.delegateTask()`).
- Hạ tầng dùng chung: `apps/server/src/shared/{errors,observability,logging,database}`.

## 12 quy tắc

1. **Single Responsibility**: mỗi class/hàm một việc.
2. **DRY**: logic chung (vd. "ai là cấp dưới hợp lệ") nằm trong domain service, gọi lại mọi nơi.
3. **KISS**: cách đơn giản nhất chạy đúng.
4. **YAGNI**: không event sourcing, CQRS, microservice, base class chung khi chưa cần.
5. **SOLID**.
6. **Clean Architecture**: như khung module ở trên.
7. **Đặt tên rõ nghĩa** (xem mục Đặt tên).
8. **Xử lý lỗi rõ ràng**: dùng `AppError` và lớp con (`code`, `retryable`, `cause`); không `catch`
   rỗng, không nuốt exception; phân biệt lỗi retry được (`EngineUnavailableError`, `RateLimitedError`).
9. **Dependency Injection** qua constructor; Nest module chỉ nối dây.
10. **Test cho business logic**; mỗi bug fix kèm regression test.
11. **Observability**: `traceId` (AsyncLocalStorage) + log JSON có cấu trúc xuyên suốt.
12. **Security by design**: validate mọi input bằng zod, không hardcode secret, không tin dữ liệu từ
    agent (đường dẫn, HTML, lệnh), không ghi token/secret vào log.

## Đặt tên

Cấm tên chung chung: `execute`, `run`, `handle`, `process`, `doWork`, `data`, `info`, `manager`,
`helper`, `util` (ESLint `id-denylist` chặn). Tên phải mô tả đúng việc: `startAgentSession`,
`cancelTaskExecution`, `recordTraceEvent`, `buildCompletionGoal`.

## Hiệu năng

Ít dependency, không ORM. Mục tiêu: RAM rảnh < 150 MB, khởi động < 2 giây, gói cài (`dist/`) < 15 MB.
Server được esbuild bundle thành một file; không cần `node_modules` khi chạy.

Ngân sách bundle web (gzip, mỗi route):

- Chunk framework Next/React (`rootMainFiles` của build manifest): không giới hạn tuyệt đối; mốc
  đo ở `scripts/web-bundle-baseline.json` (128,7 KB, Next 16.4.5), CI lỗi nếu tăng > 10%. Polyfill
  `noModule` không tính (trình duyệt hiện đại không tải). Đổi Next/React: `npm run check:bundle -- --update-baseline`.
- Code ứng dụng (mọi chunk khác, kể cả zod và contracts): ≤ 70 KB.
- Tổng tải lần đầu: ≤ 230 KB.
- Chưa dùng `zod/mini`. Web chỉ import schema mình thật sự dùng.
- Đo và kiểm tra: `npm run check:bundle` (sau `npm run build`), có trong CI.

## Chính sách lỗi (bắt buộc)

- **Theo phiên:** mọi phiên agent chạy trong `AgentSessionSupervisor`
  (`apps/server/src/shared/runtime/`). Mọi promise/stream/listener của phiên phải được `await` hoặc dẫn
  lỗi về supervisor; lỗi thành task `failed` (hoặc thử lại nếu `retryable`), không lan ra tiến trình.
  ESLint `@typescript-eslint/no-floating-promises` và `no-misused-promises` ở mức error; muốn bỏ qua
  một promise phải viết `void` có chủ ý và promise đó không được reject.
- **Cấp tiến trình** (`unhandledRejection`, `uncaughtException`): log `fatal` kèm stack và `traceId`,
  ghi `~/.aiteam/logs/crash-<timestamp>.json`, huỷ mọi phiên và lưu mốc (tối đa 5 giây), flush log,
  `exit(1)`, in hướng dẫn chạy lại `aiteam`. Không ghi log rồi chạy tiếp. Không thêm tiến trình giám sát.
- **Khi khởi động:** kill tiến trình CLI còn sống của lần chạy trước chỉ khi PID, tên (claude/codex)
  và thời điểm bắt đầu đều khớp bản ghi; task `running` → `queued` (giữ `session_ref`),
  `cancelling` → `cancelled`.

## Đổi cấu hình agent khi đang chạy task

Quy tắc chốt; Giai đoạn 2 làm sự kiện và hàm `reducesPermissions`, Giai đoạn 3 làm phần còn lại.

- Lưu cấu hình mới, phát `AgentConfigurationChanged { agentId, changes, reducesPermissions }`.
- Phiên đang chạy dùng `engine_snapshot` chụp lúc bắt đầu; thay đổi áp dụng từ phiên kế tiếp.
- Đổi provider/connection: bỏ `session_ref`, phiên mới có bản tóm tắt bàn giao. Chỉ đổi model cùng
  provider: giữ `session_ref`.
- Giảm quyền (`edit_workspace` → `read_only`, tắt `network_access`, tắt agent): huỷ lượt hiện tại ngay
  (vẫn lưu mốc), chạy lại với quyền mới.
- Cột `tasks.engine_snapshot_json` thêm bằng migration của Giai đoạn 3, không thêm sớm.

## Engine (Giai đoạn 2)

- Engine hiện thực `AgentEnginePort` (orchestration); module providers đăng ký theo provider.
- Claude Code: `claude -p --output-format stream-json --verbose --setting-sources ""
--settings {"disableAllHooks":true} --strict-mcp-config`. Không nạp file settings nào: settings người
  dùng có hook/plugin/MCP cá nhân, còn `.claude/` trong worktree do agent ghi (hook, `apiKeyHelper`
  chạy lệnh với quyền người dùng, kể cả trong phiên duyệt chỉ đọc). CLAUDE.md của dự án do nền tảng
  đọc (file thường, có giới hạn) và đặt đầu prompt. Codex: `codex exec --json --ignore-user-config`
  gọi thẳng CLI (không dùng `@openai/codex-sdk`).
- git trên worktree luôn chạy với `core.fsmonitor=false`, hook trỏ về null device,
  `commit.gpgsign=false`, diff `--no-ext-diff`. Không mở thứ không phải file thường trong worktree.
- Spawn không qua shell; prompt đi qua stdin; huỷ = kill cả cây tiến trình. Model name không được bắt
  đầu bằng `-`.
  Ngoại lệ duy nhất: lệnh kiểm thử và lệnh chạy giao diện (xem trước) của task do người dùng viết
  chạy qua shell (không bao giờ là dữ liệu từ agent).
- Agent `edit_workspace` trên Claude Code được Bash/PowerShell trong worktree; luật chặn lệnh nguy
  hiểm và mạng vẫn áp dụng. Phiên duyệt của cấp trên luôn chỉ đọc.
- Quyền mỗi lần chạy do agent quyết (`access_level`, `network_access`); cài đặt engine là trần.
- Khoá Custom API mã hoá AES-256-GCM (`~/.aiteam/secret.key`), API chỉ trả 4 ký tự cuối; đổi host
  phải nhập lại khoá; fetch tới API từ chối redirect.
- Định dạng JSONL của CLI có contract test trên bản ghi thật đã làm sạch
  (`scripts/record-engine-streams.mjs`); CLI đổi định dạng thì ghi lại và chỉ sửa translator.

## Lệnh

```
npm run lint     # eslint + prettier --check + tsc typecheck
npm test         # vitest
npm run build    # dist/server (bundle) + dist/web (Next export)
npm run check:bundle   # ngân sách bundle web (sau build)
npm run measure  # khởi động < 2 s, RAM rảnh < 150 MB, gói < 15 MB (sau build)
node bin/aiteam.mjs [--port 7419] [--no-open]   # = lệnh aimanagement sau khi cài gói
node bin/aiteam.mjs doctor
npm pack         # gói minhkhoa-aimanagement-<version>.tgz (prepack: build + smoke + bundle)
```

Gói npm `@minhkhoa/aimanagement` (tên không scope bị npm chặn vì giống `ai-management`), lệnh `aimanagement`; tên nội bộ giữ `aiteam` (`~/.aiteam`, `AITEAM_*`, cookie).
Không thêm `dependencies` vào gói: server phải chạy từ bundle, không cần `node_modules`.

## Git

Conventional Commits, commit nhỏ. Mỗi giai đoạn làm trên nhánh `feat/...`, merge vào `master` qua PR.
Không push thẳng `master`. Chỗ nào kế hoạch chưa rõ hoặc muốn làm khác kế hoạch: hỏi trước.
