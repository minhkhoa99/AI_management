# Hạn mức engine (usage limit) — thiết kế

Ngày: 2026-11-11. Nhánh đề xuất: `feat/engine-quota`, tách từ `feat/antigravity-engine` (cần engine
Antigravity, chưa vào `master`).

## 1. Mục đích

Chủ dự án chạy agent trên ba engine cục bộ đăng nhập bằng gói thuê bao của mình: Claude Code,
Codex, Antigravity. Mỗi gói có hạn mức theo cửa sổ thời gian (5 giờ, tuần). Hai nhu cầu:

1. **Biết trước còn bao nhiêu** để chọn engine cho agent trước khi giao task.
2. **Biết khi agent dừng giữa chừng vì hết lượt**, và task không chết vì chuyện đó.

Custom API không thuộc phạm vi (trả tiền theo token, không có hạn mức kiểu này).

## 2. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**

- Góc dưới thanh bên trái (mọi màn hình) hiện hạn mức còn lại của từng engine cục bộ.
- Cảnh báo màu khi sắp hết; agent dùng engine đang đỏ có dấu ⚠ trên thẻ agent.
- Khi một lượt agent dừng vì **hết hạn mức**, task tự chờ đến giờ reset rồi chạy tiếp đúng phiên cũ.

**Ngoài phạm vi**

- Tự ngừng/né giao task khi engine sắp hết (chủ dự án chọn: **chỉ cảnh báo**, không chặn).
- Tự chuyển task sang engine khác.
- Hạn mức Custom API, ngân sách tiền (ngân sách đã hoãn từ giai đoạn 5).
- Thẻ hạn mức ở trang Tổng quan hay ở chỗ chọn engine (đã xem phương án B, C; chủ dự án chọn A).
- Lịch sử/biểu đồ hạn mức theo thời gian.

**Điều phải tránh (làm vậy là hỏng dù "chạy được")**

- Hiện số đoán hoặc số cũ như số mới. Không đọc được thì nói không đọc được, kèm thời điểm của số
  cuối cùng đọc được.
- Kiểm tra hạn mức mà tốn token/lượt của người dùng.
- Task bị đánh `failed` chỉ vì hết hạn mức 5 giờ/tuần.
- Nền tảng tự đọc hoặc giữ token của CLI, gọi thẳng API nội bộ của nhà cung cấp. Chỉ đi qua CLI
  người dùng đã cài, như khi chạy agent.
- Kiểm tra hạn mức chịu rủi ro lớn hơn khi chạy agent: không bao giờ chạy trong worktree/thư mục dự
  án; Claude và Codex tắt cấu hình cá nhân như khi chạy agent. Riêng `agy` luôn nạp
  hook/MCP/plugin cá nhân từ `~/.gemini/config` — đã chấp nhận cho lượt agent (CLAUDE.md), chấp nhận
  y như vậy cho `/usage` (quyết định của người viết).
- Một task chờ hàng giờ/ngày vì bucket không áp dụng cho model của agent (mục 7.2).

## 3. Nguồn số liệu (đã thử trên máy chủ dự án, 2026-11-11)

Cả ba đều là lệnh cục bộ, không gọi model, 0 token.

### 3.1 Antigravity — `agy -p "/usage" --output-format json`

agy 1.5.5. Trả JSON có cấu trúc (không có `conversation_id`, `usage.total_tokens` = 0):

```json
{
  "status": "SUCCESS",
  "response": "…bảng tab…",
  "command": {
    "name": "usage",
    "data": {
      "groups": [
        {
          "name": "Gemini Models",
          "description": "Models within this group: Gemini Flash, Gemini Pro",
          "buckets": [
            {
              "id": "gemini-weekly",
              "name": "Weekly Limit Remaining",
              "window": "weekly",
              "remaining_fraction": 0.9934,
              "reset_time": "2026-11-17T15:58:30Z"
            },
            {
              "id": "gemini-5h",
              "name": "Five Hour Limit Remaining",
              "window": "5h",
              "remaining_fraction": 0.9986,
              "reset_time": "2026-11-11T18:09:04Z"
            }
          ]
        },
        {
          "name": "Claude and GPT models",
          "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
          "buckets": [
            { "id": "3p-weekly", "window": "weekly", "remaining_fraction": 1, "reset_time": "…" },
            { "id": "3p-5h", "window": "5h", "remaining_fraction": 1, "reset_time": "…" }
          ]
        }
      ]
    }
  }
}
```

Đọc `command.data.groups[].buckets[]`: `remaining_fraction` (0..1), `window`, `reset_time` (ISO
UTC). Không truyền `--disable-slash-commands` cho lệnh này (cờ đó tắt chính `/usage`).

### 3.2 Claude Code — `claude -p "/usage" --output-format json`

Claude Code 2.1.322. Đã thử **kèm đúng cờ nền tảng dùng khi chạy agent**
(`--setting-sources "" --settings {"disableAllHooks":true} --strict-mcp-config`): chạy được,
`total_cost_usd` 0, `num_turns` 0, `local_command: "usage"`. Số liệu nằm trong trường `result` dạng
văn bản cho người đọc:

```
Current session: 27% used · resets Nov 11, 11:59pm (Asia/Ho_Chi_Minh)
Current week (all models): 5% used · resets Nov 18, 6:59pm (Asia/Ho_Chi_Minh)
Current week (Fable): 0% used · resets Nov 18, 7pm (Asia/Ho_Chi_Minh)
```

Chỉ đọc các dòng dạng `<nhãn>: <n>% used · resets <ngày giờ> (<múi giờ>)`. "Current session" là
cửa sổ 5 giờ; "Current week (…)" là cửa sổ tuần, nhãn trong ngoặc là nhóm. Đổi `% used` thành
`% còn lại` = 100 − n. Giờ reset không có năm và theo múi giờ ghi trong ngoặc; lấy lần xuất hiện kế
tiếp tính từ lúc đọc. Phần còn lại của văn bản (gợi ý tiết kiệm, thống kê) bỏ qua.

Dòng nào không khớp mẫu thì bỏ dòng đó; không dòng nào khớp = "không đọc được". Đọc được phần
trăm mà không đọc được giờ reset thì vẫn hiện phần trăm, giờ reset để trống. (Nếu tài khoản dùng API
key thay vì thuê bao, `/usage` không có các dòng này → "không có hạn mức theo gói", không phải lỗi.)

### 3.3 Codex — `codex app-server`, JSON-RPC `account/rateLimits/read`

codex-cli 0.155.1, đã thử với số thật sau khi chủ dự án đăng nhập lại (gói `plus`). Schema đầy đủ:
`codex app-server generate-json-schema`, `v2/GetAccountRateLimitsResponse.json`. Phản hồi thật
(bỏ `accountId`):

```json
{"id":2,"result":{"ordinaryUsageAllowed":true,
  "rateLimits":{"limitId":"codex","primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1794433541},
                "secondary":{"usedPercent":3,"windowDurationMins":10080,"resetsAt":1794446113},
                "planType":"plus","rateLimitReachedType":null,"credits":{"hasCredits":false,"unlimited":false,"balance":"0"}},
  "rateLimitsByLimitId":{"codex":{…như trên…}},
  "rateLimitResetCredits":{"availableCount":2,"credits":[…]},"rateLimitUpsell":null}}
```

- Đọc `rateLimitsByLimitId` (nếu null thì `rateLimits`); mỗi snapshot có `primary` / `secondary`
  `{ usedPercent, windowDurationMins, resetsAt }`. **`resetsAt` là epoch giây** (đã xác nhận). Tên
  nhóm: `limitName` ?? `limitId`.
- Bỏ qua `rateLimitResetCredits`, `rateLimitUpsell`, `credits` (không hiển thị trong phạm vi này).
- Trao đổi: gửi `initialize` (clientInfo), notification `initialized`, rồi request
  `{"id":2,"method":"account/rateLimits/read"}`; đọc dòng có `id` 2; kill cả cây tiến trình.
- Phản hồi có `accountId`: không log, không trả ra API.
- `app-server` là tính năng đánh dấu `[experimental]` của Codex. Lỗi/đổi định dạng → "không đọc
  được", không bao giờ 500.

Tên cửa sổ hiển thị suy từ `windowDurationMins` (300 → "5 giờ", 10080 → "tuần", khác → "N giờ"/"N
ngày").

### 3.4 Mô hình chung (contracts)

Mỗi engine trả một `EngineQuotaReport`:

- `engine`: `claude_code` | `codex` | `antigravity`.
- `state`: `ok` | `not_installed` | `not_signed_in` | `unreadable` | `not_applicable`
  (không có hạn mức theo gói).
- `buckets[]`: `{ group: string|null, window: 'five_hour'|'weekly'|'other', windowLabel: string,
remainingPercent: 0..100, resetsAt: ISO|null }`.
- `checkedAt` (lần hỏi gần nhất), `lastSuccessAt` (lần đọc được gần nhất; khi `unreadable` vẫn giữ
  bucket của lần đó để hiện mờ kèm "số lúc HH:MM").

Danh sách `state` và `window` là giá trị liệt kê → đặt ở `packages/contracts/src/enumerations.ts`.
Không lưu vào SQLite (chỉ giữ trong bộ nhớ), nên không cần migration. Mọi số từ CLI parse bằng zod,
kẹp vào 0..100; tên nhóm cắt độ dài, coi là văn bản thuần.

## 4. Đọc hạn mức an toàn

- Spawn không qua shell, kill cả cây khi xong hoặc quá thời gian (đề xuất 20 giây), giống engine.
- Thư mục làm việc: một thư mục trống riêng dưới `~/.aiteam` (vd. `~/.aiteam/data/quota-probe/`),
  không bao giờ là worktree hay thư mục dự án. Trước mỗi lần hỏi `agy`, dọn các thư mục engine tự
  quản ở đó (`clearEngineManagedPaths`, `workspaceRoot` null) vì agy đọc `.agents/` từ thư mục làm
  việc.
- Claude chạy kèm `--setting-sources "" --settings {"disableAllHooks":true} --strict-mcp-config`.
- Codex: `app-server` 0.155.1 không có `--ignore-user-config` (chỉ `-c`, `--strict-config`). Đã
  kiểm tra trên máy chủ dự án (config có 2 MCP server: `hermes`, `rea`): trong lúc
  `initialize` + `account/rateLimits/read`, tiến trình `app-server` **không có tiến trình con nào**
  — MCP không khởi động. Không mở thread, không gửi gì khác. Nếu bản Codex sau đổi hành vi này thì
  coi như CLI đổi định dạng: kiểm tra lại, không được thì `unreadable`.
- Mỗi engine tối đa một lần hỏi đang chạy; yêu cầu chồng nhau dùng chung kết quả.
- Không ghi stdout thô vào log (có thể chứa id tài khoản); log chỉ ghi engine, state, thời gian.

## 5. Khi nào hỏi

- Lúc server khởi động, rồi mỗi **5 phút**.
- Ngay sau mỗi lượt agent kết thúc trên engine đó (gộp: nhiều lượt kết thúc gần nhau → một lần hỏi,
  cách nhau tối thiểu ~30 giây).
- Khi người dùng bấm ↻ ở thanh bên.
- Khi một lượt thất bại với `RATE_LIMITED` (mục 7) — hỏi ngay, bỏ qua giãn cách.
- Engine chưa cài (theo probe hiện có) → không hỏi, `not_installed`.

Giao diện lấy số qua API mới (vd. `GET /api/local-engines/quota`, `POST …/quota/refresh`) và cập
nhật khi có kết quả mới. Cách đẩy (thăm dò định kỳ phía web hay qua SSE có sẵn) để người làm chọn
theo hạ tầng hiện có.

## 6. Giao diện: thanh bên trái

Khối "Hạn mức còn lại" ở đáy `app-sidebar`, mọi màn hình. Mỗi engine cục bộ một dòng (thứ tự Claude
Code, Codex, Antigravity; Custom API không có):

- Dòng gọn: tên engine, **phần trăm thấp nhất** trong các bucket, tên cửa sổ và giờ reset của bucket
  đó ("Claude Code 73% · 5 giờ · reset 23:59"), thanh tiến độ màu engine (đã có ở
  `PROVIDER_PRESENTATION`).
- Bấm vào dòng: mở chi tiết mọi bucket theo nhóm (Antigravity: Gemini; Claude + GPT. Claude: tất cả
  model; Fable).
- Màu: < 20% vàng, < 10% đỏ (theo bucket thấp nhất).
- Trạng thái khác: "⚠ chưa đăng nhập", "chưa cài", "không đọc được hạn mức" (kèm số cũ mờ và "lúc
  HH:MM" nếu có), "không có hạn mức theo gói".
- Cuối khối: "cập nhật N phút trước" và nút ↻.
- Giờ reset hiển thị theo giờ máy; nếu không phải hôm nay thì kèm ngày (dd/MM).
- Thanh bên thu gọn/màn hẹp: người làm quyết cách gọn (vd. chỉ chấm màu) miễn vẫn thấy cảnh báo đỏ.

Cảnh báo trên agent: thẻ agent (sơ đồ tổ chức, chỗ hiện agent của task) có ⚠ khi engine của agent
đang đỏ; tooltip nêu engine và giờ reset. Không chặn giao task, không hỏi xác nhận.

Mẫu đã xem: `.superpowers/brainstorm/…/content/quota-placement.html` (phương án A).

## 7. Agent dừng giữa chừng vì hết hạn mức

Hiện tại (`FinishTaskTurnUseCase.handleEngineFailure`): lỗi `retryable` (gồm `RATE_LIMITED`) →
thử lại sau 30 s, 60 s, 120 s; quá `MAX_ENGINE_FAILURES` (3) → `failed`. Không hợp với hạn mức 5
giờ/tuần.

Mới, chỉ cho `RATE_LIMITED` của engine cục bộ:

1. Hỏi hạn mức engine đó ngay (mục 5).
2. Chỉ xét các bucket **áp dụng cho model của agent** (model lấy từ engine snapshot của lượt):
   - Claude: "Current session" và "Current week (all models)" luôn áp dụng; bucket tuần riêng một
     model (vd. "Fable") chỉ áp dụng khi tên đó có trong model của agent (không phân biệt hoa
     thường, vd. `fable`).
   - Antigravity: nhóm áp dụng khi họ model của agent có trong `description` của nhóm ("Models within
     this group: Gemini Flash, Gemini Pro" → model `gemini-*`; "Claude Opus, Claude Sonnet, GPT-OSS"
     → `claude-*`, `gpt-*`). Không khớp được nhóm nào (model mới, mô tả đổi) → xét mọi nhóm.
   - Codex: mọi bucket (`primary`/`secondary` của mọi `limitId`) đều áp dụng.
     Có bucket áp dụng với `remainingPercent` = 0 (hoặc CLI báo đã chạm giới hạn, vd. Codex
     `rateLimitReachedType`) **và** biết `resetsAt` → **hết hạn mức**: task về hàng chờ với
     `runAfter` = giờ reset **muộn nhất** trong các bucket áp dụng đã về 0, + ~1 phút (5 giờ và tuần
     cùng về 0 thì phải chờ tuần).
3. Không bucket áp dụng nào về 0, hoặc không đọc được, hoặc không có giờ reset → giữ cách cũ (thử lại
   tăng dần rồi `failed`). Một lỗi 429 ngắn trong khi bucket của model khác về 0 rơi vào nhánh này.
4. Lần chờ hạn mức **không** tăng bộ đếm lỗi engine (`countEngineFailure`), không tính vào
   `MAX_ENGINE_FAILURES`. Nếu sau giờ reset lại hết hạn mức tiếp (vd. 5 giờ reset nhưng tuần vẫn 0)
   thì lặp lại bước 1–2 với giờ reset mới.
5. Giữ `session_ref`: lượt sau resume đúng phiên, như thử lại hiện nay. **Lưu checkpoint** của
   lượt bị dừng trước khi chờ (như tạm dừng/huỷ đang làm; hiện `handleEngineFailure` không lưu), để
   thay đổi dở dang không nằm không trong worktree hàng giờ.
6. Timeline task: một dòng, vd. "Dừng vì hết hạn mức 5 giờ của Claude Code, tự chạy tiếp lúc 00:00
   (12/11)". Thẻ task: "⏸ chờ hạn mức · 00:00". Không thêm trạng thái task mới; người làm chọn cách
   đánh dấu "đang chờ hạn mức" (vd. ghi trong ghi chú/sự kiện) để giao diện phân biệt với chờ thường.
7. Đổi engine/connection của agent khi task đang chờ hạn mức → task được chạy ở lượt lập lịch kế
   tiếp (xoá `runAfter`), không chờ giờ reset của engine cũ (đổi provider đã bỏ `session_ref` theo
   quy tắc hiện có). Đổi agent được gán cho task cũng vậy.
8. Huỷ/tạm dừng task trong lúc chờ hoạt động như với task đang chờ thường.
9. Server khởi động lại: task chờ vẫn giữ `runAfter` (đã lưu), không cần gì thêm.
10. **Phiên duyệt của cấp trên** (`lead_approval`, `StepReviewLauncher.finishStepReview`) bị
    `RATE_LIMITED`: hiện chuyển sang hỏi người dùng duyệt. Mới: áp dụng cùng bước 1–3 với engine và
    model của người duyệt; hết hạn mức → task chờ đến giờ reset rồi mở lại phiên duyệt (phiên duyệt
    không resume, chạy mới như hiện nay). Không phải hết hạn mức → giữ cách cũ (hỏi người dùng).

Việc nhận ra "đây là lỗi hạn mức" giữ ở translator (`RATE_LIMITED`). Nếu luồng của CLI có sẵn giờ
reset (vd. sự kiện `rate_limit_event` của Claude khi bị từ chối), người làm có thể dùng làm nguồn
phụ, nhưng nguồn chính là đọc hạn mức ở bước 1.

## 8. Kiến trúc (gợi ý, người làm có thể đổi)

- `packages/contracts`: enum + schema `EngineQuotaReport`.
- `modules/providers`:
  - `application/ports`: cổng đọc hạn mức theo engine.
  - `infrastructure/adapters`: ba bộ đọc (`agy`, `claude`, `codex app-server`), mỗi cái parse thuần
    (hàm thuần có test trên bản ghi thật đã làm sạch, như contract test engine).
  - Use case đọc/làm mới có cache trong bộ nhớ, gộp yêu cầu, hẹn giờ 5 phút; controller API.
- `modules/orchestration`: `FinishTaskTurnUseCase` gọi qua một cổng (không import adapter của
  providers) để biết "hết hạn mức tới lúc nào"; sửa nhánh `RATE_LIMITED` như mục 7; phản ứng đổi
  engine/agent (mục 7.7) ở `AgentReconfigurationSubscriber` hoặc nơi tương đương.
- Web: khối mới trong `apps/web/src/shared/layout/app-sidebar.tsx`; ⚠ trên thẻ agent; nhãn chờ
  hạn mức trên thẻ task. Giữ ngân sách bundle (code ứng dụng ≤ 70 KB).
- `scripts/record-engine-streams.mjs` (hoặc script riêng) ghi lại đầu ra `/usage` thật để làm
  fixture; CLI đổi định dạng thì ghi lại và chỉ sửa parser.
- `bin/aiteam.mjs doctor`: không bắt buộc.
- Cập nhật CLAUDE.md (mục Engine), `docs/IMPLEMENTATION_PLAN.md`, `docs/UI_MAPPING.md`.

## 9. Kiểm thử

- Parser từng engine: bản ghi thật (đã làm sạch: bỏ `accountId`, `session_id`), dòng lạ, thiếu giờ
  reset, phần trăm ngoài 0..100, JSON hỏng, đăng nhập hỏng (Codex `refresh_token_reused` →
  `not_signed_in`).
- Giờ reset Claude: qua nửa đêm, qua năm mới, múi giờ khác giờ máy.
- Orchestration: `RATE_LIMITED` + bucket 0 → `queued` với `runAfter` đúng, không tăng bộ đếm lỗi,
  giữ `session_ref`, có checkpoint; không bucket 0 → cách cũ; hết tiếp sau reset → chờ tiếp; đổi
  engine khi đang chờ → chạy ngay; bucket về 0 của model khác (Fable khi agent dùng opus, nhóm
  Gemini khi agent dùng claude-*) → không chờ; 5 giờ + tuần cùng về 0 → chờ tới reset tuần; phiên
  duyệt cấp trên hết hạn mức → chờ rồi mở lại phiên duyệt.
- Web: trạng thái màu theo ngưỡng, các state lỗi.
- Chạy thật: cả ba engine xem số trên thanh bên (Codex đã đăng nhập lại 2026-11-11).
  Hết hạn mức thật khó tạo: dùng engine giả trong test e2e.

## 10. Còn mở / để người làm quyết

- Cách đẩy số lên web (thăm dò hay SSE), cách đánh dấu "chờ hạn mức" trên task, cách gọn khi thanh
  bên thu nhỏ.
- Phát hành: bản beta kế tiếp trên tag `next` (vd. `0.4.0-beta.1`), cùng nhánh Antigravity hoặc gộp
  khi merge — quyết lúc phát hành.

## 11. Quyết định của chủ dự án / của người viết

Chủ dự án quyết: hiện ở thanh bên trái (phương án A); chỉ cảnh báo, không tự ngừng giao task; hết hạn
mức thì tự chờ đến giờ reset rồi chạy tiếp; trừ Custom API; làm đủ cả ba engine trong lần này.

Người viết tự chọn (chủ dự án có thể sửa): hiện bucket thấp nhất ở dòng gọn, bấm xem chi tiết; ngưỡng
vàng < 20%, đỏ < 10%; hỏi mỗi 5 phút + sau mỗi lượt + nút ↻; đệm ~1 phút sau giờ reset; chỉ xét
bucket áp dụng cho model của agent, chờ tới giờ reset muộn nhất của chúng (⚠ trên thẻ agent cũng chỉ
theo bucket áp dụng; dòng gọn trên thanh bên vẫn lấy bucket thấp nhất của cả engine); đổi engine khi
đang chờ thì chạy ngay; chờ hạn mức không tính vào số lần lỗi; lưu checkpoint trước khi chờ; phiên
duyệt cấp trên cũng chờ; `agy /usage` nạp cấu hình cá nhân như lượt agent (đã chấp nhận); nhánh tách
từ `feat/antigravity-engine`; hiển thị "% còn lại" cho cả ba engine.
