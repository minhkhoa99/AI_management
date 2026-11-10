# Engine Antigravity (CLI `agy`) — thiết kế

Ngày: 2026-11-10. Nhánh làm việc: `feat/antigravity-engine`.

## 1. Mục đích

Chủ dự án muốn gán agent dev (vd. dev frontend) cho tài khoản Antigravity đã đăng nhập trên máy, để
làm việc song song với agent Claude Code và Codex trong cùng phòng ban. Luồng phối hợp không đổi:
người dùng tạo task → leader (Claude) giao subtask cho dev → dev làm xong báo lại → leader duyệt →
chuyển tester. Thứ duy nhất thêm vào là một engine thứ ba mà agent có thể chọn làm "bộ não".

"Antigravity" ở đây là **Antigravity CLI** (lệnh `agy`, cài bằng
`irm https://antigravity.google/cli/install.ps1 | iex`), không phải lệnh `antigravity` (chỉ mở cửa sổ
IDE, không chạy nền được). `agy` dùng chung đăng nhập với IDE Antigravity (Windows Credential
Manager), nên aiteam không giữ token nào, giống Claude Code và Codex.

## 2. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**

- Giá trị provider mới `antigravity`, chọn được khi thêm/sửa agent, có thẻ ở màn Cài đặt (trạng thái
  cài đặt, đăng nhập, model mặc định, chặn lệnh nguy hiểm, trần mạng, "Chạy thử").
- Agent `antigravity` chạy được task trong worktree với cả hai mức quyền (`read_only`,
  `edit_workspace`), resume được phiên, huỷ được, sống sót qua khởi động lại như hai engine kia.
- Chọn model từ danh mục thật của CLI (`agy models`).

**Ngoài phạm vi**

- Tích hợp IDE Antigravity, `agy acp`, remote agent, `--remote-control`, sandbox của `agy`
  (`--sandbox`), chế độ `--mode plan/auto`.
- Giá trị `TEAM_MODES` mới cho Antigravity. Phối hợp vẫn do orchestrator của aiteam lo.
- Chi phí USD (CLI không báo; `costUsd: null`).
- Gemini CLI (`gemini`): không dùng.

**Điều phải tránh (làm được mà vẫn là thất bại)**

- Báo task thành công khi agent bị từ chối quyền ngầm và không làm gì (xem 5.4).
- File trong worktree do agent ghi (`.agents/hooks.json`, `.agents/mcp_config.json`, plugin) chạy
  được lệnh với quyền người dùng ở lượt sau hoặc trong phiên duyệt chỉ đọc.
- Thêm thư viện, thêm tiến trình nền, hay để orchestration biết chi tiết riêng của `agy`.

## 3. Ràng buộc

Mọi quy tắc trong `CLAUDE.md` của dự án áp dụng nguyên vẹn. Những điều liên quan trực tiếp:

- Spawn không qua shell, prompt đi qua stdin, huỷ = kill cả cây tiến trình, tên model không bắt đầu
  bằng `-`.
- Giá trị liệt kê định nghĩa một lần trong `packages/contracts`; SQL `CHECK` khớp; migration mới, không
  sửa migration cũ; migration dựng lại bảng đặt `rebuildsTables: true`.
- Định dạng JSONL của CLI có contract test trên bản ghi thật đã làm sạch
  (`scripts/record-engine-streams.mjs`).
- Không tin dữ liệu từ agent; không ghi token vào log.
- Phiên bản đã kiểm tra: `agy` 1.5.4 trên Windows 11.

## 4. Những gì đã quan sát thật (2026-11-10, `agy` 1.5.4)

Chạy trong thư mục tạm, model `gemini-3.8-flash-low`.

**Lệnh chạy được, prompt qua stdin:**

```
agy --input-format stream-json --output-format stream-json --model <slug> [--settings <file>]
stdin: {"event":"user","message":{"content":"<prompt>"}}\n   rồi đóng stdin
```

Không kèm `-p` (kèm thì lỗi, exit 2). Đóng stdin sau một dòng → chạy một lượt rồi thoát.

**Luồng sự kiện (mỗi dòng một JSON):**

```
{"event":"init","conversation_id":"<uuid>","init":{"model":"…","cwd":"…","tools":[…]}}
{"event":"step_update","step_update":{"conversation_id":"…","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{…,"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"C:\\…\\note.txt"}}}}
{"event":"step_update","step_update":{…,"step_index":2,"state":"DONE","step_type":"tool","tool_name":"read_file","duration_seconds":0.23,"tool_info":{…,"output":"1 lines, 25 bytes"}}}
{"event":"step_update","step_update":{…,"step_index":4,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"},"error":{"type":"TOOL_ERROR","message":"permission check failed for unsandboxed \"echo hi\": user denied permission…"}}}}
{"event":"step_update","step_update":{…,"step_index":5,"state":"ACTIVE","step_type":"agent_response","text_delta":"I have created the"}}
{"event":"step_update","step_update":{…,"step_index":5,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":2.37,"usage":{"input_tokens":11977,"output_tokens":103,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":12080}}}
{"event":"result","result":{"conversation_id":"…","status":"SUCCESS","response":"…","duration_seconds":25.3,"num_turns":1,"usage":{"input_tokens":27084,"output_tokens":393,…},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}
```

Tên tool đã thấy: `read_file`, `write_file`, `run_command`. `agent_response` không phải lúc nào cũng
có `text_delta` (bước chỉ gọi tool thì không có).

**Hành vi quyền khi không truyền settings:**

- Ghi file trong thư mục làm việc: được, không hỏi.
- Lệnh shell: bị từ chối ngầm. Lượt vẫn kết thúc `status: "SUCCESS"`, exit 0, `response` rỗng,
  `denied_actions` có phần tử, stderr in `jetski: no output produced — a tool required the "command"
  permission…`.

**Hết giờ (`--print-timeout`)**: `result.finished_reason: "print_timeout"`; `status` lúc `SUCCESS` lúc
`ERROR`, exit lúc 0 lúc 3; stderr có dòng
`AGY_ERROR: {"short_error":"…","status":"DEADLINE_EXCEEDED","retryable":false,"reason":"print_timeout"}`.

**Khác:**

- Trình cài đặt đặt file thực thi gốc `C:\Users\<user>\AppData\Local\agy\bin\agy.exe` và thêm thư mục
  đó vào PATH người dùng: `resolveCliExecutable('agy')` tìm được, không cần đường phân giải mới.
- `--mode plan` không phải chỉ đọc: ghi `~/.gemini/antigravity-cli/brain/<id>/plan.md` rồi dừng chờ
  duyệt. Không dùng.
- `agy models` in mỗi dòng `<slug>\t<nhãn>` sau dòng `Fetching available models...`; chạy được nghĩa
  là đã đăng nhập. Danh sách hiện tại gồm cả model Gemini, Claude và GPT-OSS.
- Tốc độ thất thường: phản hồi đầu tiên 10–125 giây.

**Theo tài liệu (antigravity.google/docs), chưa tự kiểm chứng:**

- `--settings`: "JSON object of settings.json keys, inline or as a file path" (đã dùng dạng file).
- Luật quyền: `permissions: { allow: [], ask: [], deny: [] }`, mỗi luật `action(target)`; action:
  `read_file`, `write_file`, `read_url`, `execute_url`, `command`, `mcp`; `command(prefix)` khớp theo
  từng từ, `command(regex:…)`, `*` khớp tất cả; thứ tự ưu tiên Deny > Ask > Allow; deny áp dụng mọi
  chế độ. Trên Windows, lệnh không tách được thành từ phải khớp nguyên dòng.
- Hook nạp từ `<workspace>/.agents/hooks.json`, `~/.gemini/config/hooks.json` và plugin; MCP từ
  `<workspace>/.agents/mcp_config.json`, `~/.gemini/config/mcp_config.json` và plugin
  (`<workspace>/.agents/plugins/<plugin>/`). Không có cờ tắt được ghi trong tài liệu.
- Resume: `--conversation <id>`.
- Chưa đăng nhập, không có terminal: thoát với `authentication required`.

## 5. Thiết kế

### 5.1 Giá trị liệt kê và dữ liệu

- `AGENT_PROVIDERS` và `LOCAL_ENGINES` thêm `'antigravity'` (đặt sau `'codex'`).
- Migration `013`: dựng lại `agents` (CHECK `provider`) và `local_engine_settings` (CHECK `engine`),
  thêm dòng mặc định cho `antigravity` giống hai engine kia. `rebuildsTables: true`.
  `enumerations.test.ts` phải tự bắt được giá trị mới.
- Quy tắc agent hiện có giữ nguyên: engine local không có `connectionId`; agent mới bắt đầu
  `read_only`, không mạng.

### 5.2 Lệnh gọi

`AntigravityCliEngine` hiện thực `AgentEnginePort`, cùng khuôn `CodexCliEngine` (dùng
`streamCliOutput`, `resolveCliExecutable('agy')`, `assertEngineSessionRef`, `toFailedEvent`).

```
agy --input-format stream-json --output-format stream-json --disable-slash-commands
    --settings <settings của lượt>
    [--model <model>] [--conversation <resumeSessionRef>]
cwd = request.workingDirectory
stdin = một dòng JSON {"event":"user","message":{"content": request.prompt}} + "\n"
```

- Hướng dẫn dự án: nền tảng đọc các file `CLAUDE.md` (cùng hàm, cùng giới hạn như engine Claude Code)
  và đặt đầu prompt, để agent Antigravity làm theo đúng bộ quy tắc mà leader Claude dùng khi duyệt.
- Không truyền `--print-timeout` (mặc định chờ tới khi xong; supervisor lo việc huỷ).
- Không truyền `--mode`, `--sandbox`, `--dangerously-skip-permissions`, `--add-dir`.
- `--settings`: ưu tiên JSON inline (spawn không qua shell nên không có vấn đề quoting). Nếu kiểm chứng
  E (mục 6) cho thấy inline không chạy, ghi file tạm **ngoài worktree**, xoá khi phiên kết thúc.

### 5.3 Quyền mỗi lượt (`--settings`)

Dựng từ `SessionPermissions`; hàm thuần, có unit test như `listDisallowedClaudeTools`.

Luôn có:

- `allowNonWorkspaceAccess: false`
- `deny`: `mcp(*)`, `execute_url(*)` (không dùng MCP và trình duyệt tự động trong aiteam).

| Điều kiện | Luật |
|---|---|
| `accessLevel = read_only` | `deny`: `write_file(*)`, `command(*)` |
| `accessLevel = edit_workspace` | `allow`: `command(*)`; `deny`: `write_file` vào `.agents/` của worktree |
| `networkAccess = false` | `deny`: `read_url(*)`, lệnh `curl`, `wget`, `Invoke-WebRequest` |
| `networkAccess = true` | `allow`: `read_url(*)` |
| `blockDangerousCommands = true` | `deny`: `rm -rf`, `git push`, `git reset --hard`, `npm publish`, `Remove-Item` |

Danh sách lệnh nguy hiểm và lệnh mạng phải cùng nội dung với engine Claude Code. Hiện các hằng đó nằm
trong `claude-code-cli.engine.ts` theo cú pháp của Claude; người làm tự quyết cách dùng chung (DRY)
mà không ép hai cú pháp vào một.

Mức bảo vệ giống Claude Code: danh sách chặn theo mẫu lệnh, không phải sandbox. Ghi rõ điều này trong
chú thích của engine như Codex/Claude đang làm.

### 5.4 Dịch sự kiện (`AntigravityStreamTranslator`)

| Dòng của `agy` | Sự kiện aiteam |
|---|---|
| `init` | `session_started { sessionRef: conversation_id, model: init.model }` |
| `step_update` `agent_response` có `text_delta` | `text_delta`; gom theo `step_index`, khi `DONE` phát `message` nếu văn bản gom được không rỗng (theo đúng quy ước `text_delta`/`message` mà translator Claude đang dùng) |
| `step_update` `tool`, `state: ACTIVE` | bỏ qua |
| `tool` `run_command`, `DONE`/`ERROR` | `command { command: parameters.CommandLine, exitCode: null nếu CLI không cho, output: tool_info.output hoặc error.message (cắt bằng truncateEngineText) }` |
| `tool` `write_file`, `DONE`, đường dẫn nằm trong worktree | `file_change { path, changeKind: 'update' }` (CLI không phân biệt tạo/sửa) |
| tool khác, hoặc `write_file` ngoài worktree | `tool_call { toolName, detail: describeToolInput(parameters) }` |
| `result` | `usage { inputTokens, outputTokens, costUsd: null }` lấy từ `result.usage` (không cộng usage từng bước, tránh đếm trùng), rồi sự kiện kết thúc theo bảng dưới |
| loại không biết | bỏ qua |

Sự kiện kết thúc, xét theo thứ tự:

1. Tiến trình bị huỷ (`exit.cancelled`) → `cancelled`.
2. `result.finished_reason = "print_timeout"` → `failed { code: 'ENGINE_TIMEOUT', retryable: true }`.
3. `result.status ≠ "SUCCESS"` → `failed`, phân loại theo thông báo (`result.error`, hoặc
   `short_error` trong dòng `AGY_ERROR:` của stderr) giống `classifyCodexFailure`:
   `ENGINE_AUTH_FAILED` (`authentication required`, đăng nhập lại…), `RATE_LIMITED` (quota, 429…,
   retryable), `MODEL_NOT_FOUND`, còn lại `ENGINE_REPORTED_ERROR`.
4. `status = "SUCCESS"`, `denied_actions` không rỗng **và** `response` rỗng →
   `failed { code: 'ENGINE_PERMISSION_DENIED', retryable: false }`, thông báo tiếng Việt nêu loại hành
   động bị từ chối và gợi ý kiểm tra quyền của agent.
5. `status = "SUCCESS"` còn lại → `completed { summary: response, hoặc message cuối nếu response rỗng }`.
6. Thoát mà không có `result` → `failed { code: 'ENGINE_PROCESS_FAILED', retryable: true }` với dòng
   có nghĩa cuối của stderr (như Codex).

Luôn đúng một sự kiện kết thúc mỗi phiên.

### 5.5 Dọn worktree trước mỗi lượt

`agy` nạp hook, MCP và plugin từ `.agents/` của thư mục làm việc, và không có cờ tắt. Agent ghi được
vào worktree, nên:

"Ba đường dẫn" dưới đây = `.agents/hooks.json`, `.agents/mcp_config.json`, `.agents/plugins/`.

- **Loại khỏi git ở mọi worktree, bất kể engine.** Khi chuẩn bị worktree của task, ba đường dẫn được
  thêm vào danh sách loại trừ (cùng cơ chế với `.aiteam-skills/`), mẫu không neo gốc để khớp ở mọi cấp
  thư mục. Nhờ vậy `git add -A` lúc lưu mốc không bao giờ đưa chúng vào nhánh task, kể cả khi agent
  Claude/Codex ghi ra ở lượt trước; không agent nào có thể làm chúng thành "được theo dõi".
- **Xoá trước mỗi lượt Antigravity.** Thư mục làm việc của engine là `agentDirectory`, có thể là thư
  mục con của worktree. Trước khi spawn, xoá ba đường dẫn ở thư mục làm việc và ở mọi thư mục cha cho
  tới gốc worktree (phạm vi chính xác chốt theo kiểm chứng C). Chỉ xoá thứ **không** được git theo
  dõi. Gặp symlink thì xoá chính liên kết, không đi theo.
- **Dự án đã theo dõi sẵn.** "Được theo dõi" = có trong `HEAD` của worktree (do loại trừ ở trên, điều
  này chỉ xảy ra khi chính dự án của người dùng đã commit chúng). Khi đó lượt Antigravity dừng với lỗi
  `ENGINE_WORKSPACE_UNSUPPORTED` (không retry), giải thích engine Antigravity chưa hỗ trợ dự án có cấu
  hình hook/MCP/plugin Antigravity riêng. Không lặng lẽ xoá file của dự án. Engine khác không bị ảnh
  hưởng.

Cách đưa gốc worktree và việc kiểm tra git tới chỗ dọn do người làm quyết, với điều kiện
orchestration không chứa kiến thức riêng về `agy` (truyền qua một khái niệm chung, vd. "đường dẫn do
engine quản lý").

Chấp nhận, ghi vào `CLAUDE.md`:

- File hướng dẫn trong worktree (`GEMINI.md`, `AGENTS.md`) được `agy` tự đọc. Chỉ là văn bản, không
  chạy lệnh.
- Cấu hình cấp người dùng (`~/.gemini/config/hooks.json`, `mcp_config.json`, plugin đã cài) vẫn được
  nạp: đó là nội dung của chính người dùng, nhưng làm lượt chạy kém tái lập hơn Claude/Codex. Lời gọi
  MCP vẫn bị `deny: mcp(*)` chặn.

### 5.6 Trạng thái engine và danh mục model

- Probe (`CliLocalEngineProbe`): `agy --version`; đăng nhập suy từ `agy models` — chạy được →
  `signedIn: true`; lỗi chứa `authentication required` → `false`, `problem: 'Chưa đăng nhập. Chạy: agy'`;
  lỗi khác → `signedIn: null` kèm dòng lỗi đầu. `accountDetail: null` (CLI không cho biết tài khoản).
- Danh mục: cổng mới đọc `agy models`, parse từng dòng `<slug>\t<nhãn>` (bỏ dòng không khớp), lọc tên
  model an toàn như danh mục Codex, `note` để trống hoặc suy từ nhãn. Lỗi → `models: []` kèm `problem`,
  không bao giờ 500. Cache 10 phút, không cache lỗi (như Codex). Probe và danh mục nên dùng chung một
  lần gọi `agy models` trong thời gian cache.
- `ListLocalEngineModelsUseCase` hiện viết riêng cho Codex; người làm tổng quát hoá vừa đủ cho hai CLI
  có danh mục (không dựng base class).
- Model mặc định của engine để trống → không truyền `--model`, `agy` tự chọn.

### 5.7 Tiến trình và khôi phục

- Tên tiến trình ghi nhận là `agy` (qua `normaliseProcessName`). Nơi nào đang liệt kê tên được phép
  kill khi khởi động (`claude`/`codex`) phải thêm `agy`.
- `session_ref` = `conversation_id` (UUID); phải qua được `assertEngineSessionRef`.
- Quy tắc đổi cấu hình agent giữ nguyên: đổi provider sang/từ `antigravity` bỏ `session_ref`; chỉ đổi
  model trong `antigravity` giữ `session_ref`.

### 5.8 Giao diện

Theo đúng mẫu hiện có, không thêm màn hình:

- Cài đặt: thẻ engine thứ ba "Antigravity" (`local-engine-card.tsx`), hướng dẫn cài
  (`irm https://antigravity.google/cli/install.ps1 | iex`) và đăng nhập (chạy `agy` một lần).
- Thêm thành viên / sửa bộ não agent: lựa chọn "Antigravity" (nhãn ở `organization-labels.ts`), ô model
  dùng danh mục từ API, placeholder ví dụ `gemini-3.8-flash-high`.
- Tổng quan: màu riêng cho `antigravity` trong `overview-figures.tsx`.
- Giữ ngân sách bundle web.

### 5.9 Kiểm thử và tài liệu

- Bản ghi thật đã làm sạch (đường dẫn, tên người dùng, conversation id) cho: đọc file, sửa file + chạy
  lệnh được phép, lệnh bị từ chối (`denied_actions`), hết giờ, resume. Thêm vào
  `scripts/record-engine-streams.mjs` và `engine-stream.contract.test.ts`.
- Unit test: dựng lệnh gọi (`cli-invocations.test.ts`), dựng settings quyền, translator (đủ 6 nhánh
  kết thúc), parse `agy models`, dọn `.agents/`.
- E2E: danh sách engine trả ba mục; cấu hình và chạy thử engine `antigravity` với engine giả.
- `bin/aiteam.mjs doctor`: kiểm tra `agy` như `claude`/`codex`.
- Cập nhật `CLAUDE.md` (mục Engine) và `docs/IMPLEMENTATION_PLAN.md`, `docs/UI_MAPPING.md` nơi liệt kê
  engine.

## 6. Bước 0: kiểm chứng trước khi viết code engine

Làm bằng script ghi stream, trong thư mục tạm, chạy **tuần tự** (chạy song song 4 lượt làm backend
chậm tới mức hết giờ). Mỗi mục ghi lại kết quả vào file này.

| # | Câu hỏi | Nếu không đạt |
|---|---|---|
| A | `deny: write_file(*), command(*)` có thật sự chặn ghi file và lệnh, mà agent vẫn đọc và trả lời được không? (Lượt thử đầu hết giờ trước khi tới bước ghi.) | Dừng, hỏi chủ dự án. "Chạy thử" ở Cài đặt và phiên duyệt đều cần chỉ đọc. |
| B | `allow: command(*)` có cho chạy test/build không; luật `deny` lệnh nguy hiểm có thắng `allow` trên PowerShell không (kể cả lệnh "không tách được thành từ")? | Thử `command(regex:…)`; vẫn không đạt thì dừng, hỏi. |
| C | `.agents/hooks.json` có chạy ở chế độ headless không (dùng đúng định dạng ở antigravity.google/docs/hooks; hai định dạng đoán thử đều không chạy)? `agy` đọc `.agents/` từ đâu: thư mục làm việc, gốc git, hay mọi thư mục cha? File ghi giữa lượt có hiệu lực ngay trong lượt đó không? Ngoài ba đường dẫn, còn gì trong thư mục làm việc chạy được lệnh (file settings cấp workspace, lệnh/skill/rule trong `.agents/`)? | Chạy được → 5.5 là hàng rào bắt buộc (đã thiết kế); phạm vi xoá theo đúng nơi `agy` đọc. Có thêm đường dẫn chạy được lệnh → thêm vào danh sách ở 5.5. Có hiệu lực giữa lượt → ghi nhận: agent `edit_workspace` có thể tự gỡ luật `deny` trong chính lượt của nó; báo chủ dự án trước khi làm tiếp. |
| D | `--conversation <id>` tiếp tục được phiên trước ở chế độ stream-json? | Engine không resume; mỗi lượt là phiên mới kèm tóm tắt bàn giao. Báo chủ dự án. |
| E | `--settings` nhận JSON inline? | Dùng file tạm ngoài worktree. |
| F | Trong lúc chạy, `agy.exe` có sinh tiến trình con/daemon tên khác không (stderr có tiền tố `jetski:`)? Kill cây tiến trình giữa lượt có để sót gì không? | Thêm tên tiến trình thật vào danh sách được kill khi khởi động (5.7); không dừng sạch được thì báo. |
| G | Hình dạng lỗi khi model sai và khi hết hạn mức (dòng `result`/`AGY_ERROR`) | Bổ sung mẫu phân loại ở 5.4. |
| H | Luật `deny: write_file` vào `.agents/` viết đường dẫn thế nào thì khớp trên Windows? | Bỏ luật này; 5.5 vẫn đủ. |

## 8. Kết quả kiểm chứng (2026-11-10/11, `agy` 1.5.4, Windows 11)

| # | Kết quả | Bằng chứng |
|---|---|---|
| A | Đạt | Với `deny: write_file(*), command(*)`: đọc `note.txt` được; `write_file` và `run_command` trả `TOOL_ERROR … Matches user-configured deny rule`; `x.txt` không được tạo; agent vẫn trả lời. |
| B | Đạt với regex | `allow: command(*)` cho chạy `node --version`. Luật tiền tố chỉ khớp khi trùng nguyên dòng: `command(git push)` chặn `git push` nhưng `command(Remove-Item)` để lọt `Remove-Item note.txt` (file bị xoá), `command(npm publish)` để lọt `npm publish --dry-run`. Regex khớp **cả dòng**: `(?i)rm[ ]+-rf` không chặn `rm -rf sub`; `(?i).*remove-item.*`, `(?i).*npm[ ]+publish.*`, `(?i).*git[ ]+push.*` chặn được, kể cả `cmd /c "git push"`. Luật chứa `\s` bị từ chối khi khởi động (`invalid escape sequence`), `\b` bị hiểu thành backspace: không dùng dấu `\`. |
| C | Hook chạy | `.agents/hooks.json` ở thư mục làm việc và ở gốc git (khi chạy từ thư mục con) đều được nạp và thực thi ở chế độ headless (`JSON hook "jsonhook__probe_PreToolUse_0_0" …`). Hook do agent ghi giữa lượt **không** có hiệu lực trong lượt đó, có hiệu lực ở lượt sau. Tài liệu còn liệt kê trong `.agents/`: plugin, MCP, subagent (`agents/*.md` có `commandExecutionPolicy`), manifest trỏ ra ngoài; thư mục tương đương `.agent/`, `_agents/`, `_agent/`; và `.gemini/config.json` chuyển hướng thư mục cấu hình. |
| D | Đạt | Lượt 2 với `--conversation <id>` trả đúng số đã nhớ, cùng `conversation_id`. |
| E | Đạt | `--settings` nhận JSON inline khi spawn không qua shell. |
| F | Đạt | Chỉ có một tiến trình `agy.exe`; sau `taskkill /T /F` không còn gì. |
| G | Ghi nhận | Model sai: `result.status: "ERROR"`, `error: "invalid model selection (--model …): model … is not recognized as a known model…"`, không có `init`, mã thoát 1. Quá tải: `API error (attempt 5): UNAVAILABLE (code 503): No capacity available for model …`. Rớt luồng: `The stream was interrupted. Please continue the task you were working on.` |
| H | Đạt | `deny: write_file(.agents/), write_file(.agents)` chặn tạo `.agents/hooks.json`, vẫn cho tạo `x.txt`. |

Hệ quả so với mục 5:

- 5.3: mọi luật lệnh dùng `command(regex:(?i).*<đầu lệnh, dấu cách → [ ]+>.*)`, không có dấu `\`.
- 5.5: "ba đường dẫn" mở rộng thành **năm thư mục** `.agents`, `.agent`, `_agents`, `_agent`, `.gemini` (cả thư mục), ở thư mục làm việc và mọi thư mục cha tới gốc worktree. Dự án đã commit một trong các thư mục này thì engine Antigravity từ chối chạy.
- 5.4: thêm `ENGINE_UNAVAILABLE` (retry được) cho quá tải/rớt luồng; output lệnh có dòng `Command exited with code N.`; luật `deny` tường minh không sinh `denied_actions`.
- Thêm loại bước `error_message`, `system_message`, `subagent`: bỏ qua.

## 7. Quyết định của ai

**Chủ dự án đã chốt:** thêm engine Antigravity chạy bằng CLI `agy`, dùng đăng nhập sẵn có trên máy;
tên hiển thị "Antigravity"; vai trò chính là agent dev nhận việc từ leader Claude; làm theo khuôn
Claude/Codex.

**Người thiết kế tự quyết (chủ dự án có thể bác):**

- Giá trị enum `antigravity`; nhánh `feat/antigravity-engine`.
- Không dùng `--mode`, sandbox, ACP; quyền hoàn toàn qua `--settings`.
- Luôn chặn MCP và trình duyệt tự động của `agy`.
- Lệnh bị từ chối + câu trả lời rỗng = task `failed` (`ENGINE_PERMISSION_DENIED`).
- `write_file` luôn báo `changeKind: 'update'`.
- Dự án đã theo dõi `.agents/hooks.json`/`mcp_config.json`/`plugins/` bằng git → từ chối chạy.
- Chấp nhận việc `agy` vẫn nạp cấu hình cấp người dùng.
- Ba đường dẫn `.agents/…` bị loại khỏi git ở worktree của **mọi** engine, không riêng Antigravity.
- Agent Antigravity nhận nội dung `CLAUDE.md` của dự án ở đầu prompt (Codex hiện không nhận).
- **Khác với trao đổi ban đầu:** hỗ trợ cả `read_only` (không giới hạn agent Antigravity ở vai được
  sửa), vì "Chạy thử" và agent mới tạo đều chỉ đọc. Điều kiện: kiểm chứng A đạt.

**Để người làm quyết:** tên class/file, cách tổng quát hoá use case danh mục model, cách dùng chung
danh sách lệnh nguy hiểm, vị trí đặt phần loại trừ git, số file migration, màu trên biểu đồ.
