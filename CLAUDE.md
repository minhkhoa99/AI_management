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
- Một tiến trình Node duy nhất, chỉ lắng nghe `127.0.0.1`. API yêu cầu token phiên (trừ `/api/health`).

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

## Lệnh

```
npm run lint     # eslint + prettier --check + tsc typecheck
npm test         # vitest
npm run build    # dist/server (bundle) + dist/web (Next export)
node bin/aiteam.mjs [--port 4321] [--no-open]
node bin/aiteam.mjs doctor
```

## Git

Conventional Commits, commit nhỏ. Mỗi giai đoạn làm trên nhánh `feat/...`, merge vào `master` qua PR.
Không push thẳng `master`. Chỗ nào kế hoạch chưa rõ hoặc muốn làm khác kế hoạch: hỏi trước.
