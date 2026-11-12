# Engine Antigravity (CLI `agy`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm engine local thứ ba `antigravity` (CLI `agy`) để agent chọn làm bộ não, cạnh Claude Code và Codex.

**Architecture:** Cùng khuôn `CodexCliEngine`: engine dựng lệnh gọi + settings quyền cho từng lượt, `streamCliOutput` chạy `agy`, một translator đổi JSONL của `agy` thành `AgentEngineEvent`. Các mảnh thuần (settings, translator, parser danh mục, dọn workspace) làm trước và không cần giá trị enum; một task nối dây cuối cùng thêm enum + migration + DI + web cùng lúc để typecheck không gãy giữa chừng.

**Tech Stack:** NestJS + Fastify, `node:sqlite` (SQL viết tay), zod, Vitest, Next.js export. Không thêm dependency.

**Spec:** `docs/superpowers/specs/2026-11-10-antigravity-engine-design.md` (đọc trước; mục "5.x", "kiểm chứng A–H" trong plan này trỏ về spec).

## Global Constraints

- Mọi quy tắc trong `CLAUDE.md` gốc dự án: Clean Architecture theo module, `AppError` (không `catch` rỗng), tên không chung chung (`execute`, `run`, `handle`, `process`, `data`, `info`, `helper`, `util` bị ESLint chặn), DI qua constructor, zod cho input, không ghi token vào log.
- Spawn không qua shell; prompt đi qua stdin; huỷ = kill cả cây tiến trình; tên model không bắt đầu bằng `-`.
- Không thêm thư viện, không thêm tiến trình nền, orchestration không chứa kiến thức riêng về `agy`.
- Migration đã phát hành không sửa; migration dựng lại bảng đặt `rebuildsTables: true`.
- Giá trị enum mới: đúng chuỗi `antigravity`, đặt sau `codex`. Tên hiển thị: `Antigravity`. Lệnh: `agy`.
- Phiên bản CLI đã kiểm tra: `agy` 1.5.4, Windows 11. Lệnh `agy` thật chỉ chạy **tuần tự** (chạy song song làm backend chậm tới hết giờ).
- Ngân sách bundle web giữ nguyên (`npm run check:bundle`).
- Conventional Commits, commit nhỏ, nhánh `feat/antigravity-engine`, không push `master`.
- Lệnh kiểm tra: `npx vitest run <đường dẫn>` cho một file; `npm run lint`, `npm test`, `npm run build` cho toàn bộ.

## Review Focus

1. **Prompt nhiều dòng, có dấu nháy, tiếng Việt**: stdin phải là đúng một dòng NDJSON (`JSON.stringify`), kết thúc bằng `\n`. → test ở Task 5.
2. **`.agents` (hoặc file bên trong) là symlink/junction do agent tạo, trỏ ra ngoài worktree**: chỉ gỡ liên kết, không xoá đích. → test ở Task 4.
3. **`agy models` in thêm dòng lạ, CRLF, dòng trống, tên model bắt đầu bằng `-`**: lấy dòng hợp lệ, bỏ phần còn lại; không dòng hợp lệ nào → `problem`, không 500. → test ở Task 6.
4. **Dòng stdout không phải JSON, loại sự kiện lạ, `tool_info` thiếu trường**: bỏ qua, không ném lỗi, vẫn đúng một sự kiện kết thúc. → test ở Task 3.
5. **`SUCCESS` + `denied_actions` nhưng `response` không rỗng** (agent tự xoay xở): `completed`, không `failed`; và **thoát không có `result`, stderr rỗng**: `ENGINE_PROCESS_FAILED` có thông báo. → test ở Task 3.

---

## File Structure

Tạo mới (đều dưới `apps/server/src/modules/providers/` trừ khi ghi khác):

| File                                                                    | Trách nhiệm                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `domain/command-restrictions.ts`                                        | Danh sách đầu lệnh nguy hiểm và lệnh mạng, không phụ thuộc cú pháp engine |
| `infrastructure/adapters/engines/antigravity-settings.ts`               | `SessionPermissions` → JSON `--settings` của `agy`                        |
| `infrastructure/adapters/engines/antigravity-stream-translator.ts`      | JSONL của `agy` → `AgentEngineEvent`                                      |
| `infrastructure/adapters/engines/antigravity-workspace-guard.ts`        | Xoá/kiểm tra ba đường dẫn `.agents/…` trước lượt chạy                     |
| `infrastructure/adapters/engines/antigravity-cli.engine.ts`             | `AgentEnginePort` + `buildAntigravityInvocation`                          |
| `infrastructure/adapters/cli-antigravity-model-catalog.ts`              | Đọc và parse `agy models`                                                 |
| `application/ports/antigravity-model-catalog.port.ts`                   | Cổng danh mục model                                                       |
| `apps/server/src/shared/runtime/engine-managed-paths.ts`                | Hằng: đường dẫn trong worktree mà CLI engine nạp cấu hình chạy được lệnh  |
| `apps/server/src/shared/runtime/safe-git-options.ts`                    | `SAFE_GIT_OPTIONS` chuyển ra dùng chung                                   |
| `apps/server/src/shared/database/migrations/013_antigravity_engine.sql` | CHECK mới cho `agents.provider`, `local_engine_settings.engine`           |
| `…/engines/__fixtures__/antigravity-*.jsonl`                            | Bản ghi thật đã làm sạch                                                  |

Sửa: `claude-code-cli.engine.ts`, `git-task-workspace.ts`, `agent-engine-resolver.ts`, `cli-local-engine.probe.ts`, `list-local-engine-models.use-case.ts`, `providers.module.ts`, `recover-interrupted-work.use-case.ts`, `packages/contracts/src/{enumerations,providers}.ts`, `migrations/index.ts`, `scripts/record-engine-streams.mjs`, `bin/aiteam.mjs`, các file web ở Task 8, tài liệu ở Task 9.

---

### Task 1: Nhánh và kiểm chứng `agy` (cổng chặn)

Không viết code sản phẩm. Kết quả quyết định vài giá trị ở các task sau.

**Files:**

- Modify: `docs/superpowers/specs/2026-11-10-antigravity-engine-design.md` (thêm mục "## 8. Kết quả kiểm chứng")

- [ ] **Step 1: Tạo nhánh, commit spec và plan**

```bash
git checkout -b feat/antigravity-engine
git add docs/superpowers
git commit -m "docs: design and plan for the Antigravity engine"
```

- [ ] **Step 2: Chạy kiểm chứng A–H của spec mục 6, từng lượt một**

Thư mục tạm ngoài repo, có `git init` + một commit, một file `note.txt`. Lệnh nền:

```
echo '{"event":"user","message":{"content":"<prompt>"}}' | agy --input-format stream-json --output-format stream-json --disable-slash-commands --model gemini-3.8-flash-low --print-timeout 240s --settings <file hoặc JSON>
```

Mỗi mục lưu stdout, stderr, mã thoát và trạng thái thư mục sau khi chạy.

- A: settings `{"allowNonWorkspaceAccess":false,"permissions":{"deny":["mcp(*)","execute_url(*)","write_file(*)","command(*)","read_url(*)"]}}`; prompt: đọc `note.txt`, tạo `x.txt`, chạy `echo hi`, báo cáo việc nào bị từ chối. Đạt = có câu trả lời, `x.txt` không tồn tại, lệnh không chạy.
- B: settings `allow: ["command(*)"]`, `deny: ["mcp(*)","execute_url(*)","command(rm -rf)","command(git push)","command(git reset --hard)","command(npm publish)","command(Remove-Item)"]`; prompt: chạy `node --version`, rồi `Remove-Item note.txt`, rồi `git push`. Đạt = lệnh đầu chạy, hai lệnh sau bị từ chối, `note.txt` còn.
- C: đọc trang `https://antigravity.google/docs/hooks/` lấy đúng mẫu `hooks.json`; đặt hook `SessionStart` và `PreToolUse` ghi file đánh dấu, lần lượt ở (1) thư mục làm việc, (2) thư mục cha là gốc git khi chạy từ thư mục con. Ghi lại hook có chạy không ở từng vị trí; thêm một lượt yêu cầu agent tự ghi `hooks.json` rồi gọi tiếp một tool để xem có hiệu lực giữa lượt không. Đọc `https://antigravity.google/docs/settings?tab=cli` tìm file cấu hình cấp workspace nào khác chạy được lệnh.
- D: lượt 1 "Hãy nhớ số 4721"; lượt 2 với `--conversation <conversation_id của lượt 1>` hỏi lại số đó.
- E: lặp lại A với `--settings` là chuỗi JSON inline, spawn bằng `child_process.spawn` không shell (viết vài dòng Node tạm).
- F: giữa một lượt dài, `taskkill /pid <pid> /T /F`; trước và sau đó liệt kê tiến trình có tên chứa `agy`, `jetski`, `antigravity`.
- G: `--model model-that-does-not-exist`; ghi dòng `result` và dòng `AGY_ERROR:` của stderr.
- H: với settings của B thêm một luật `deny` ghi vào `.agents/`, thử lần lượt `write_file(.agents/)` và `write_file(.agents)`; prompt: tạo `.agents/hooks.json`.

- [ ] **Step 3: Ghi kết quả vào spec mục 8**, mỗi mục một dòng: đạt/không đạt + bằng chứng ngắn (trích dòng JSON hoặc trạng thái file).

- [ ] **Step 4: Áp dụng cổng chặn**

| Kết quả                           | Hành động                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A không đạt                       | **Dừng.** Báo chủ dự án.                                                                                                                                                     |
| B không đạt với `command(prefix)` | Thử `command(regex:…)`; đạt thì Task 2 dùng dạng regex; vẫn không đạt → **dừng**, báo.                                                                                       |
| C: hook chạy                      | Bình thường (Task 4 đã lo). Có thêm đường dẫn chạy được lệnh → thêm vào `ENGINE_MANAGED_WORKSPACE_PATHS` ở Task 4. Có hiệu lực giữa lượt → **dừng**, báo trước khi làm tiếp. |
| D không đạt                       | **Dừng**, báo (spec: engine không resume).                                                                                                                                   |
| E không đạt                       | Task 5 ghi settings ra file tạm trong `os.tmpdir()`, xoá trong `finally`.                                                                                                    |
| F: có tiến trình tên khác         | Thêm tên đó vào `KILLABLE_PROCESS_NAMES` ở Task 7. Còn sót sau kill → **dừng**, báo.                                                                                         |
| G                                 | Bổ sung mẫu regex vào `classifyAntigravityFailure` ở Task 3.                                                                                                                 |
| H đạt                             | Task 2 thêm đúng dạng luật khớp được vào `deny` của `edit_workspace`. Không đạt → bỏ luật đó.                                                                                |

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs
git commit -m "docs: record agy verification results"
```

---

### Task 2: Settings quyền cho `agy`

**Files:**

- Create: `apps/server/src/modules/providers/domain/command-restrictions.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-settings.ts`
- Test: `apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-settings.test.ts`
- Modify: `apps/server/src/modules/providers/infrastructure/adapters/engines/claude-code-cli.engine.ts:28-40`

**Interfaces:**

- Produces:
  - `DANGEROUS_COMMAND_PREFIXES: { shell: readonly string[]; powershell: readonly string[] }` = `shell: ['rm -rf', 'git push', 'git reset --hard', 'npm publish']`, `powershell: ['Remove-Item']`
  - `NETWORK_COMMAND_PREFIXES` cùng dạng = `shell: ['curl', 'wget']`, `powershell: ['Invoke-WebRequest']`
  - `interface AntigravitySettings { allowNonWorkspaceAccess: false; permissions: { allow: string[]; deny: string[] } }`
  - `buildAntigravitySettings(permissions: SessionPermissions): AntigravitySettings`

Kết quả kiểm chứng (spec mục 8) đã chốt cú pháp:

- Luật lệnh dạng tiền tố `command(git push)` trên Windows chỉ khớp khi trùng **nguyên dòng lệnh**. Phải dùng regex khớp cả dòng: `command(regex:(?i).*<đầu lệnh>.*)`, trong đó mỗi dấu cách của đầu lệnh thay bằng `[ ]+`. **Không được có dấu `\`** trong luật (`agy` giải mã chuỗi hai lần: `\s` bị từ chối, `\b` thành ký tự backspace). Ví dụ `git reset --hard` → `command(regex:(?i).*git[ ]+reset[ ]+--hard.*)`.
- Cấm ghi vào thư mục cấu hình: với mỗi mục `d` của `ENGINE_MANAGED_WORKSPACE_PATHS` (tạo ở task này, xem Interfaces) thêm hai luật `write_file(d/)` và `write_file(d)`.

Thêm vào Interfaces của task này (Task 4 dùng lại, không tạo lại): file `apps/server/src/shared/runtime/engine-managed-paths.ts` xuất `ENGINE_MANAGED_WORKSPACE_PATHS: readonly string[]` = `['.agents', '.agent', '_agents', '_agent', '.gemini']`. Chú thích: thư mục trong worktree mà CLI engine tự nạp cấu hình chạy được lệnh (hook, MCP, plugin, subagent, chuyển hướng thư mục cấu hình); không bao giờ được commit, bị xoá trước lượt chạy của engine đọc chúng.

- [ ] **Step 1: Viết test fail**

```ts
const readOnlyOffline = {
  accessLevel: 'read_only',
  networkAccess: false,
  blockDangerousCommands: true,
} as const;
const editOnline = {
  accessLevel: 'edit_workspace',
  networkAccess: true,
  blockDangerousCommands: false,
} as const;
const MANAGED_WRITE_DENIES = [
  'write_file(.agents/)',
  'write_file(.agents)',
  'write_file(.agent/)',
  'write_file(.agent)',
  'write_file(_agents/)',
  'write_file(_agents)',
  'write_file(_agent/)',
  'write_file(_agent)',
  'write_file(.gemini/)',
  'write_file(.gemini)',
];

it('read-only, offline: denies writes, commands, urls, MCP and the browser', () => {
  expect(buildAntigravitySettings(readOnlyOffline)).toEqual({
    allowNonWorkspaceAccess: false,
    permissions: {
      allow: [],
      deny: [
        'mcp(*)',
        'execute_url(*)',
        'write_file(*)',
        'command(*)',
        'read_url(*)',
        'command(regex:(?i).*curl.*)',
        'command(regex:(?i).*wget.*)',
        'command(regex:(?i).*Invoke-WebRequest.*)',
        'command(regex:(?i).*rm[ ]+-rf.*)',
        'command(regex:(?i).*git[ ]+push.*)',
        'command(regex:(?i).*git[ ]+reset[ ]+--hard.*)',
        'command(regex:(?i).*npm[ ]+publish.*)',
        'command(regex:(?i).*Remove-Item.*)',
      ],
    },
  });
});

it('edit, online, dangerous commands allowed: commands and urls pre-approved, config folders write-protected', () => {
  expect(buildAntigravitySettings(editOnline)).toEqual({
    allowNonWorkspaceAccess: false,
    permissions: {
      allow: ['command(*)', 'read_url(*)'],
      deny: ['mcp(*)', 'execute_url(*)', ...MANAGED_WRITE_DENIES],
    },
  });
});

it('edit, offline, blocking: dangerous and network commands denied although commands are allowed', () => {
  const settings = buildAntigravitySettings({
    ...editOnline,
    networkAccess: false,
    blockDangerousCommands: true,
  });
  expect(settings.permissions.allow).toEqual(['command(*)']);
  expect(settings.permissions.deny).toEqual(
    expect.arrayContaining([
      'read_url(*)',
      'command(regex:(?i).*curl.*)',
      'command(regex:(?i).*git[ ]+push.*)',
    ]),
  );
  expect(settings.permissions.deny).not.toContain('command(*)');
});

it('no rule contains a backslash (agy decodes rule strings twice)', () => {
  for (const permissions of [
    readOnlyOffline,
    editOnline,
    { ...editOnline, networkAccess: false, blockDangerousCommands: true },
  ]) {
    expect(JSON.stringify(buildAntigravitySettings(permissions).permissions)).not.toContain('\\');
  }
});
```

- [ ] **Step 2: Chạy, xác nhận fail** — `npx vitest run apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-settings.test.ts` → FAIL (module chưa tồn tại).

- [ ] **Step 3: Viết `command-restrictions.ts` và `buildAntigravitySettings`**. Thứ tự `deny`: cố định → theo `accessLevel` → mạng → nguy hiểm (đúng thứ tự trong test).

- [ ] **Step 4: Cho Claude dùng chung danh sách**: trong `claude-code-cli.engine.ts`, `NETWORK_COMMAND_RULES` và `DANGEROUS_COMMAND_RULES` dựng từ hai hằng mới (`Bash(<p>:*)` cho `shell`, `PowerShell(<p>:*)` cho `powershell`). Giá trị kết quả phải y như cũ.

- [ ] **Step 5: Chạy** — file test mới + `npx vitest run apps/server/src/modules/providers/infrastructure/adapters/engines/cli-invocations.test.ts` → PASS cả hai (test Claude không sửa).

- [ ] **Step 6: Commit** — `feat(providers): build per-run permission settings for agy`

---

### Task 3: Translator và bản ghi thật

**Files:**

- Modify: `scripts/record-engine-streams.mjs`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/engines/__fixtures__/antigravity-{read-only,edit,denied-command,cancelled,invalid-model}.jsonl`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-stream-translator.ts`
- Test: `…/engines/antigravity-stream-translator.test.ts`, `…/engines/engine-stream.contract.test.ts`

**Interfaces:**

- Consumes: `CliOutput` (`cli-process.ts`), `describeToolInput`, `truncateEngineText` (`engine-text.ts`)
- Produces:

  ```ts
  class AntigravityStreamTranslator {
    constructor(workingDirectory: string);
    translateAntigravityLine(rawLine: string): AgentEngineEvent[];
    translateAntigravityExit(exit: Extract<CliOutput, { kind: 'exit' }>): AgentEngineEvent[];
  }
  ```

- [ ] **Step 1: Mở rộng script ghi**: thêm nhóm `antigravity` vào `RECORDINGS`; mỗi bản ghi `agy` gửi stdin là `JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n'` (thêm một trường tuỳ chọn cho bản ghi để đổi cách dựng stdin; Claude/Codex giữ nguyên). Tham số chung: `--input-format stream-json --output-format stream-json --disable-slash-commands --model gemini-3.8-flash-low --settings <JSON>`. Khi làm sạch sự kiện `init` của `agy`: bỏ `init.tools`. Năm bản ghi:

| Tên                          | Settings (theo `buildAntigravitySettings`)     | Prompt                                              |
| ---------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `antigravity-read-only`      | read_only, offline, block                      | `READ_PROMPT`                                       |
| `antigravity-edit`           | edit_workspace, offline, block                 | `EDIT_PROMPT` + " Sau đó chạy lệnh: node --version" |
| `antigravity-denied-command` | read_only, offline, block                      | "Chạy lệnh: node --version. Không làm gì khác."     |
| `antigravity-cancelled`      | read_only                                      | `LONG_PROMPT`, huỷ sau 15000 ms                     |
| `antigravity-invalid-model`  | read_only, `--model model-that-does-not-exist` | "Chào"                                              |

- [ ] **Step 2: Ghi** — `node scripts/record-engine-streams.mjs antigravity` (tuần tự, tốn ít hạn mức). Kiểm tra 5 file không chứa đường dẫn cá nhân, email, UUID thật.

- [ ] **Step 3: Viết test fail** (`antigravity-stream-translator.test.ts`, dùng dòng JSON viết tay theo mẫu ở spec mục 4):

```ts
const exit = { kind: 'exit', exitCode: 0, stderrTail: '', cancelled: false } as const;
const translator = () => new AntigravityStreamTranslator('C:\\work\\task');
const line = (event: object) => JSON.stringify(event);
const result = (fields: object) => line({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: '', usage: { input_tokens: 10, output_tokens: 2 }, ...fields } });

it('init starts the session with the conversation id and model', () =>
  expect(translator().translateAntigravityLine(line({ event: 'init', conversation_id: 'c1', init: { model: 'm' } })))
    .toEqual([{ kind: 'session_started', sessionRef: 'c1', model: 'm' }]));

it('streams text deltas and emits one message when the step is done', () => {
  const t = translator();
  const step = (state: string, text: string) => line({ event: 'step_update', step_update: { step_index: 5, state, step_type: 'agent_response', text_delta: text } });
  expect(t.translateAntigravityLine(step('ACTIVE', 'Xin '))).toEqual([{ kind: 'text_delta', text: 'Xin ' }]);
  expect(t.translateAntigravityLine(step('DONE', 'chào'))).toEqual([{ kind: 'text_delta', text: 'chào' }, { kind: 'message', text: 'Xin chào' }]);
});

it('an agent_response step without text emits nothing', …toEqual([]));
it('run_command DONE becomes a command event', … { kind: 'command', command: 'echo hi', exitCode: null, output: 'hi' });
it('run_command ERROR carries the denial message as output', …);
it('write_file inside the working directory is a file change', … { kind: 'file_change', path: 'C:\\work\\task\\x.txt', changeKind: 'update' });
it('write_file outside the working directory is a plain tool call', …  // Path: C:\\Users\\u\\.gemini\\antigravity-cli\\brain\\c1\\plan.md → kind 'tool_call', toolName 'write_file'
it('other tools become tool calls; ACTIVE tool steps are ignored', …);

it('SUCCESS → usage then completed with the response', () =>
  expect(translator().translateAntigravityLine(result({ response: 'xong' }))).toEqual([
    { kind: 'usage', inputTokens: 10, outputTokens: 2, costUsd: null },
    { kind: 'completed', summary: 'xong' },
  ]));
it('SUCCESS with an empty response falls back to the last message', …);
it('SUCCESS, denied actions, empty response → ENGINE_PERMISSION_DENIED, not retryable', …);
it('SUCCESS, denied actions, non-empty response → completed', …);
it('finished_reason print_timeout → ENGINE_TIMEOUT, retryable, whatever the status', …);
it('status ERROR "authentication required" → ENGINE_AUTH_FAILED', …);
it('status ERROR quota/429 → RATE_LIMITED, retryable', …);
it('exit after a result emits nothing more', …toEqual([]));
it('cancelled exit → exactly one cancelled event', …);
it('exit without a result uses short_error of the AGY_ERROR stderr line', …  // stderrTail: 'x\nAGY_ERROR: {"short_error":"boom","status":"INTERNAL","retryable":false}' → { kind: 'failed', code: 'ENGINE_PROCESS_FAILED', message: 'boom', retryable: true }
it('exit without a result and empty stderr still fails with a message naming the exit code', …);
it('ignores non-JSON lines, unknown events and tool steps with missing fields', …toEqual([]));
```

Đường dẫn file: giữ nguyên dạng tuyệt đối CLI trả về (như translator Claude). "Trong thư mục làm việc" = so sánh sau `path.resolve`, không phân biệt hoa thường trên Windows.

- [ ] **Step 4: Chạy, xác nhận fail.**

Bổ sung từ kiểm chứng (spec mục 8), thêm test tương ứng ở Step 3:

- Output của `run_command` khi chạy được có dạng `Command exited with code <N>.\n\nCommand output:\n<văn bản>` hoặc `Command exited with code <N>.\n\nNo output from the command.` → `exitCode: N`, `output` là phần văn bản (rỗng ở dạng thứ hai). Không khớp mẫu → `exitCode: null`, `output` nguyên văn.
- `step_type` `error_message`, `system_message`, `subagent`: bỏ qua.
- `status: "ERROR"` vẫn là `failed` kể cả khi `response` không rỗng.
- Phân loại lỗi thêm: `UNAVAILABLE|code 503|No capacity available|stream was interrupted` → `{ code: 'ENGINE_UNAVAILABLE', retryable: true }`; `invalid model selection|not recognized as a known model` → `MODEL_NOT_FOUND` (trường hợp này không có dòng `init`, `conversation_id` rỗng, mã thoát 1).
- Luật `deny` tường minh từ chối một tool thì **không** có `denied_actions`; agent nhận lỗi tool và trả lời bình thường → `completed`.

- [ ] **Step 5: Viết translator** theo bảng ở spec 5.4. `classifyAntigravityFailure(message)` cùng dạng `classifyCodexFailure` (auth: `authentication required|sign in|log ?in|unauthori[sz]ed|401`; rate: `rate limit|quota|too many requests|429|RESOURCE_EXHAUSTED`; model: mẫu từ kiểm chứng G; còn lại `ENGINE_REPORTED_ERROR`). Thông báo `ENGINE_PERMISSION_DENIED`: `Antigravity từ chối hành động (<display_name, …>) và không trả lời. Kiểm tra quyền của agent (mức truy cập, mạng).`

- [ ] **Step 6: Thêm contract test trên bản ghi** vào `engine-stream.contract.test.ts` (hàm `translateAntigravityFixture` cùng dạng hai hàm sẵn có): read-only → có `session_started`, ít nhất một `tool_call`, kết thúc `completed`, không có `file_change`; edit → có `file_change` của `hello.txt` và một `command`; denied-command → kết thúc `failed` mã `ENGINE_PERMISSION_DENIED` hoặc `completed` (theo bản ghi thật: khẳng định đúng cái đã ghi được); cancelled (exit `cancelled: true`) → đúng một `cancelled`; invalid-model → `failed` mã `MODEL_NOT_FOUND`, không retry. Mọi bản ghi: đúng một sự kiện kết thúc.

- [ ] **Step 7: Chạy cả hai file test → PASS.**

- [ ] **Step 8: Commit** — `feat(providers): translate agy stream-json into engine events`

---

### Task 4: Dọn workspace và loại trừ git

**Files:**

- Create: `apps/server/src/shared/runtime/engine-managed-paths.ts`, `apps/server/src/shared/runtime/safe-git-options.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-workspace-guard.ts`
- Test: `…/engines/antigravity-workspace-guard.test.ts`
- Modify: `apps/server/src/modules/orchestration/infrastructure/adapters/git-task-workspace.ts` (`SAFE_GIT_OPTIONS` dòng 39-50, `prepareTaskWorkspace`, `excludeFromGit`)
- Test: file test hiện có của `git-task-workspace` (tìm bằng `Glob **/git-task-workspace*.test.ts`; không có thì thêm vào `task-execution.e2e.test.ts`)

**Interfaces:**

- Produces:
  - Consumes `ENGINE_MANAGED_WORKSPACE_PATHS` = `['.agents', '.agent', '_agents', '_agent', '.gemini']` (đã tạo ở Task 2 trong `shared/runtime/engine-managed-paths.ts`; không tạo lại). Kiểm chứng C cho thấy `agy` nạp hook từ `.agents/` của thư mục làm việc **và** của mọi thư mục cha tới gốc git, và tài liệu liệt kê nhiều thứ chạy được lệnh trong đó (hook, MCP, plugin, subagent, manifest trỏ ra ngoài, `.gemini/config.json` chuyển hướng thư mục cấu hình), nên quản lý **cả thư mục** thay vì ba file. Mọi chỗ trong task này nói "ba đường dẫn" hay `.agents/hooks.json`… đều hiểu là năm thư mục này; test dùng `.agents/hooks.json` làm ví dụ file bên trong, và ca "leaves other files in .agents/ alone" đổi thành "removes the whole .agents directory, keeps other files of the working directory".
  - `SAFE_GIT_OPTIONS: readonly string[]` (chuyển nguyên từ `git-task-workspace.ts`)
  - `clearEngineManagedPaths(workingDirectory: string): Promise<void>` — ném `AppError` mã `ENGINE_WORKSPACE_UNSUPPORTED`, `retryable: false`

- [ ] **Step 1: Viết test fail cho guard** (thư mục tạm thật, `git init` thật, như các test git sẵn có):

```ts
it('removes untracked .agents/hooks.json, mcp_config.json and plugins/ in the working directory', …);
it('also removes them in every parent up to the worktree root', …);   // cwd = <root>/apps/web
it('leaves other files in .agents/ alone', …);                          // .agents/skills/x.md còn nguyên
it('refuses to run when the project tracks one of the paths', async () => {
  // commit .agents/hooks.json rồi gọi
  await expect(clearEngineManagedPaths(root)).rejects.toMatchObject({ code: 'ENGINE_WORKSPACE_UNSUPPORTED', retryable: false });
  expect(existsSync(path.join(root, '.agents/hooks.json'))).toBe(true);
});
it('removes a link without following it', …);  // .agents là junction/symlink tới thư mục ngoài chứa hooks.json → đích còn nguyên, liên kết bị gỡ
it('outside a git repository only the working directory is cleaned', …);
```

- [ ] **Step 2: Chạy, xác nhận fail.**

- [ ] **Step 3: Viết guard**. Gốc worktree = `git rev-parse --show-toplevel` (execFile, không shell, `SAFE_GIT_OPTIONS`, timeout 20 s); lệnh fail → coi như không có repo, chỉ dọn thư mục làm việc. Tập thư mục = thư mục làm việc và các thư mục cha tới gốc. Đường dẫn được theo dõi = `git ls-files -z -- <các đường dẫn ứng viên tương đối với gốc>`; có kết quả → ném lỗi với thông báo: `Dự án đã commit cấu hình Antigravity (<đường dẫn>). Engine Antigravity chưa hỗ trợ dự án có hook/MCP/plugin Antigravity riêng.` Xoá: `lstat` từng thành phần (`.agents` trước); là liên kết → `unlink`/`rmdir` chính liên kết rồi thôi; là file/thư mục thường → `rm` đệ quy.

- [ ] **Step 4: Loại trừ git ở mọi worktree**: trong `prepareTaskWorkspace`, sau khi có `agentDirectory`, gọi loại trừ cho từng mục của `ENGINE_MANAGED_WORKSPACE_PATHS` với mẫu `**/<đường dẫn>` (mẫu có `/` ở giữa bị neo vào gốc nếu thiếu `**/`). `excludeFromGit` hiện tự thêm `/` cuối cho thư mục: tách phần "thêm một dòng mẫu nếu chưa có" thành hàm riêng nhận mẫu hoàn chỉnh, hai lời gọi cũ (`.aiteam-qa/`, `.aiteam-skills/`) cho kết quả như cũ. Đổi `SAFE_GIT_OPTIONS` sang import từ `shared/runtime`.

- [ ] **Step 5: Test loại trừ**: sau `prepareTaskWorkspace`, tạo `.agents/hooks.json` và `sub/.agents/plugins/p/hooks.json` trong worktree, gọi `saveCheckpoint` → `git ls-files` của worktree không chứa hai file đó; một file thường khác tạo cùng lúc thì có.

- [ ] **Step 6: Chạy** test guard + test workspace + `npx vitest run apps/server/src/modules/orchestration` → PASS.

- [ ] **Step 7: Commit** — `feat: keep engine-managed .agents config out of task worktrees`

---

### Task 5: Engine và lệnh gọi

**Files:**

- Create: `apps/server/src/modules/providers/infrastructure/adapters/engines/antigravity-cli.engine.ts`
- Test: `apps/server/src/modules/providers/infrastructure/adapters/engines/cli-invocations.test.ts`

**Interfaces:**

- Consumes: `buildAntigravitySettings` (Task 2), `AntigravityStreamTranslator` (Task 3), `clearEngineManagedPaths` (Task 4), `readClaudeProjectInstructions(workingDirectory): string | null`, `assertEngineSessionRef`, `resolveCliExecutable`, `streamCliOutput`, `toFailedEvent`, `CLI_PROCESS_TRACKER`
- Produces:
  - `buildAntigravityInvocation(request: AgentSessionRequest, projectInstructions?: string | null): CliInvocation`
  - `@Injectable() class AntigravityCliEngine implements AgentEnginePort`

- [ ] **Step 1: Viết test fail** (trong `cli-invocations.test.ts`, dùng helper request sẵn có của file):

```ts
describe('buildAntigravityInvocation', () => {
  it('reads the prompt from stdin as one NDJSON user event', () => {
    const invocation = buildAntigravityInvocation(request({ prompt: 'Dòng 1\nDòng "2"' }));
    expect(invocation.stdinText.endsWith('\n')).toBe(true);
    expect(invocation.stdinText.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(invocation.stdinText)).toEqual({ event: 'user', message: { content: 'Dòng 1\nDòng "2"' } });
    expect(invocation.args).not.toContain('-p');
  });
  it('passes fixed flags and the per-run settings as inline JSON', () => {
    const { args } = buildAntigravityInvocation(request({ permissions: readOnlyOffline }));
    expect(args.slice(0, 5)).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands']);
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual(buildAntigravitySettings(readOnlyOffline));
    for (const flag of ['--mode', '--sandbox', '--dangerously-skip-permissions', '--print-timeout', '--add-dir']) expect(args).not.toContain(flag);
  });
  it('adds --model only when a model is set', …);
  it('resumes with --conversation <ref> and rejects a ref that looks like an option', …);  // '-x' → throws ENGINE_SESSION_REF_INVALID
  it('puts the project instructions before the prompt', …);  // cùng khối văn bản như Claude: tiêu đề, nội dung, '---', prompt
});
```

Nếu kiểm chứng E không đạt: `--settings` là đường dẫn file; đổi test thành đọc file đó, và engine xoá file trong `finally`.

- [ ] **Step 2: Chạy, xác nhận fail.**

- [ ] **Step 3: Viết `buildAntigravityInvocation` và `AntigravityCliEngine.startSession`**. `startSession` theo đúng khung `CodexCliEngine.startSession`, thêm trước khi dựng lệnh: `await clearEngineManagedPaths(request.workingDirectory)` (lỗi `AppError` → `toFailedEvent`, kết thúc). Khối ghép hướng dẫn dự án + prompt hiện nằm trong `buildClaudeInvocation`: tách thành hàm dùng chung trong `claude-project-instructions.ts` (vd. `prependProjectInstructions(prompt, instructions)`), Claude gọi lại hàm đó, kết quả y như cũ. Chú thích đầu class nêu: quyền qua `--settings`, mức bảo vệ là danh sách mẫu lệnh (không sandbox), cấu hình cấp người dùng của `agy` vẫn được nạp.

- [ ] **Step 4: Chạy** `cli-invocations.test.ts` + `claude-project-instructions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(providers): add the Antigravity CLI engine`

---

### Task 6: Danh mục model

**Files:**

- Create: `apps/server/src/modules/providers/application/ports/antigravity-model-catalog.port.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/cli-antigravity-model-catalog.ts`
- Test: `apps/server/src/modules/providers/infrastructure/adapters/cli-antigravity-model-catalog.test.ts`

**Interfaces:**

- Produces:
  - `ANTIGRAVITY_MODEL_CATALOG: symbol`; `interface AntigravityModelCatalog { listAntigravityModels(): Promise<LocalEngineModelChoice[]> }`
  - `parseAntigravityModelList(rawOutput: string): LocalEngineModelChoice[]`
  - `@Injectable() class CliAntigravityModelCatalog implements AntigravityModelCatalog`

- [ ] **Step 1: Viết test fail**

```ts
const REAL_OUTPUT = 'Fetching available models...\r\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\r\n';

it('reads slug and label of each tab-separated line, in the CLI order', () =>
  expect(parseAntigravityModelList(REAL_OUTPUT)).toEqual([
    { model: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', note: '' },
    { model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', note: '' },
  ]));
it('skips noise, blank lines and unsafe model names', () =>
  expect(parseAntigravityModelList('warning: x\n\n-rf\tBad\nok-model\tOK\n')).toEqual([{ model: 'ok-model', label: 'OK', note: '' }]));
it('uses the slug as label when the label is missing', …);  // 'solo-model\n' không có tab → bỏ qua; 'solo-model\t\n' → label 'solo-model'
it('throws ANTIGRAVITY_MODEL_CATALOG_UNREADABLE when no line is a model', …);  // EngineUnavailableError
```

- [ ] **Step 2: Chạy, xác nhận fail.**

- [ ] **Step 3: Viết parser và adapter** theo khuôn `cli-codex-model-catalog.ts`: `agy models` qua `execFile` không shell, timeout 20 s, `maxBuffer` 1 MB; lỗi chạy → `EngineUnavailableError` mã `ANTIGRAVITY_MODEL_CATALOG_FAILED`, thông báo `Không đọc được danh sách model của Antigravity (agy models). Vẫn tự nhập tên được.` Lọc tên bằng `modelNameSchema`, tối đa 30 mục, nhãn tối đa 60 ký tự.

- [ ] **Step 4: Chạy → PASS.**

- [ ] **Step 5: Commit** — `feat(providers): read the agy model list`

---

### Task 7: Nối dây server (enum, migration, DI, probe, khôi phục)

**Files:**

- Modify: `packages/contracts/src/enumerations.ts:13`, `packages/contracts/src/providers.ts:9` (+ chú thích dòng 84, 93)
- Create: `apps/server/src/shared/database/migrations/013_antigravity_engine.sql`
- Modify: `apps/server/src/shared/database/migrations/index.ts`
- Modify: `…/providers/infrastructure/adapters/engines/agent-engine-resolver.ts`, `…/adapters/cli-local-engine.probe.ts`, `…/application/use-cases/list-local-engine-models.use-case.ts`, `…/providers.module.ts`
- Modify: `apps/server/src/modules/orchestration/application/use-cases/recover-interrupted-work.use-case.ts:23`
- Modify: `apps/server/src/modules/agents/domain/entities/agent.ts:157` (chú thích), `apps/web/src/features/organization/organization-labels.ts`, `apps/web/src/features/providers/components/local-engine-card.tsx`, `apps/web/src/features/overview/components/overview-figures.tsx` (chỉ thêm mục để typecheck qua; nội dung chốt ở Task 8)
- Test: `list-local-engine-models.use-case.test.ts`, `providers.e2e.test.ts`, `enumerations.test.ts` (tự bao phủ), test của `cli-local-engine.probe` nếu có, `startup-recovery.e2e.test.ts`

**Interfaces:**

- Consumes: `AntigravityCliEngine` (Task 5), `ANTIGRAVITY_MODEL_CATALOG`, `CliAntigravityModelCatalog` (Task 6)
- Produces: `AGENT_PROVIDERS = ['claude_code', 'codex', 'antigravity', 'custom_api']`, `LOCAL_ENGINES = ['claude_code', 'codex', 'antigravity']`

- [ ] **Step 1: Viết test fail**
  - `providers.e2e.test.ts`: danh sách engine `toEqual(['claude_code', 'codex', 'antigravity'])`; `PATCH /api/local-engines/antigravity/settings` lưu được; tạo agent `provider: 'antigravity'` thành công và từ chối khi kèm `connectionId` (`CONNECTION_NOT_APPLICABLE`).
  - `list-local-engine-models.use-case.test.ts`: `listLocalEngineModels('antigravity')` trả danh mục từ cổng giả; gọi lần hai trong 10 phút không gọi lại cổng; cổng ném `AppError` → `{ models: [], problem: <message> }` và lần sau gọi lại cổng.
  - `startup-recovery.e2e.test.ts`: bản ghi tiến trình tên `agy` khớp PID + thời điểm bắt đầu thì bị kill (cùng dạng ca `codex` sẵn có).

- [ ] **Step 2: Chạy, xác nhận fail.**

- [ ] **Step 3: Contracts** — thêm `'antigravity'` vào hai mảng; sửa hai chú thích nhắc Claude/Codex cho đủ ba engine.

- [ ] **Step 4: Migration 013** (`rebuildsTables: true`, `version: 13`, `name: 'antigravity-engine'`):

```sql
-- 013 Antigravity engine: 'antigravity' joins AGENT_PROVIDERS and LOCAL_ENGINES (packages/contracts).
-- Both tables are rebuilt to widen their CHECK (runner: rebuildsTables).

CREATE TABLE agents_rebuilt (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL
                         CHECK (role IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support')),
  provider       TEXT    NOT NULL CHECK (provider IN ('claude_code', 'codex', 'antigravity', 'custom_api')),
  connection_id  TEXT    REFERENCES provider_connections (id) ON DELETE RESTRICT,
  model          TEXT,
  access_level   TEXT    NOT NULL DEFAULT 'read_only'
                         CHECK (access_level IN ('read_only', 'edit_workspace')),
  network_access INTEGER NOT NULL DEFAULT 0 CHECK (network_access IN (0, 1)),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  CHECK (provider <> 'custom_api' OR connection_id IS NOT NULL)
);
INSERT INTO agents_rebuilt
  (id, name, role, provider, connection_id, model, access_level, network_access, enabled)
  SELECT id, name, role, provider, connection_id, model, access_level, network_access, enabled
  FROM agents;
DROP TABLE agents;
ALTER TABLE agents_rebuilt RENAME TO agents;
CREATE INDEX idx_agents_connection ON agents (connection_id);

CREATE TABLE local_engine_settings_rebuilt (
  engine                   TEXT    PRIMARY KEY CHECK (engine IN ('claude_code', 'codex', 'antigravity')),
  default_model            TEXT,
  block_dangerous_commands INTEGER NOT NULL DEFAULT 1 CHECK (block_dangerous_commands IN (0, 1)),
  allow_network            INTEGER NOT NULL DEFAULT 0 CHECK (allow_network IN (0, 1)),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO local_engine_settings_rebuilt SELECT * FROM local_engine_settings;
DROP TABLE local_engine_settings;
ALTER TABLE local_engine_settings_rebuilt RENAME TO local_engine_settings;
INSERT INTO local_engine_settings (engine) VALUES ('antigravity');
```

Trước khi viết: đối chiếu định nghĩa `agents` hiện hành (`PRAGMA table_info(agents)` và `SELECT sql FROM sqlite_master WHERE tbl_name = 'agents'` trên DB đã migrate tới 12) — cột, index, trigger phải được giữ đủ; lệch với khối trên thì theo DB thật.

- [ ] **Step 5: Nối dây**
  - `EngineRegistry`: thêm `AntigravityCliEngine` vào constructor, `case 'antigravity'`.
  - `ENGINE_COMMANDS.antigravity = { executableName: 'agy', statusArgs: ['models'] }`; thêm `readAntigravitySignIn(status)`: chạy được → `signedIn: true, accountDetail: null, problem: null`; output chứa `authentication required` (không phân biệt hoa thường) → `signedIn: false, problem: 'Chưa đăng nhập. Chạy: agy'`; lỗi khác → `signedIn: null, problem: <dòng đầu>`. Thay phép chọn hai nhánh `engine === 'claude_code' ? … : …` bằng bảng theo engine.
  - `ListLocalEngineModelsUseCase`: nhận thêm `@Inject(ANTIGRAVITY_MODEL_CATALOG)`; cache theo engine (`Map<'codex' | 'antigravity', …>`) với cùng thời hạn `CODEX_CATALOG_CACHE_MS` (đổi tên thành `ENGINE_CATALOG_CACHE_MS`), cùng quy tắc không cache lỗi.
  - `providers.module.ts`: đăng ký `AntigravityCliEngine`, `{ provide: ANTIGRAVITY_MODEL_CATALOG, useClass: CliAntigravityModelCatalog }`.
  - `KILLABLE_PROCESS_NAMES`: thêm `'agy'` (+ tên từ kiểm chứng F).
  - Ba file web: thêm mục `antigravity` tối thiểu để `tsc` qua.

- [ ] **Step 6: Chạy** — `npm test` → PASS toàn bộ (gồm `enumerations.test.ts` cho hai CHECK mới); `npm run lint` → sạch.

- [ ] **Step 7: Commit** — `feat: register the Antigravity engine (contracts, migration 013, wiring)`

---

### Task 8: Giao diện

**Files:**

- Modify: `apps/web/src/features/organization/organization-labels.ts`, `apps/web/src/features/providers/components/local-engine-card.tsx`, `…/local-engine-model-field.tsx:75`, `…/settings-screen.tsx:19-60`, `apps/web/src/features/overview/components/overview-figures.tsx:9`, `apps/web/src/features/tasks/components/task-form-panel.tsx:347`, `apps/web/src/features/org/components/{add-member-panel,agent-brain-form}.tsx`

**Interfaces:**

- Consumes: `AGENT_PROVIDERS`, `LOCAL_ENGINES` (Task 7)

- [ ] **Step 1: Nội dung cố định**

| Chỗ                                 | Giá trị                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_PRESENTATION.antigravity` | `label: 'Antigravity'`, `note: 'Tài khoản Antigravity đã đăng nhập'`, `background: '#2A1F4D'`, `foreground: '#CDBBFF'`                                                                                                                                                |
| `ENGINE_PRESENTATION.antigravity`   | `name: 'Antigravity'`, `mark: 'AG'`, `via: 'agy · tài khoản Antigravity đã đăng nhập'`, `modelPlaceholder: 'Mặc định của Antigravity'`, cùng màu trên                                                                                                                 |
| `commandSafety` của Antigravity     | `kind: 'toggle'`, `label` y như Claude Code, `hint: 'Lọc theo đầu lệnh, không chặn được mọi cách viết khác. Antigravity vẫn nạp hook và MCP cá nhân của bạn trong ~/.gemini/config. Agent được sửa chạy lệnh với quyền của bạn: chỉ cấp quyền sửa cho việc bạn tin.'` |
| Màu biểu đồ tổng quan               | `antigravity: '#A78BFA'`                                                                                                                                                                                                                                              |
| Placeholder ô model                 | theo engine: Claude `vd. claude-sonnet-5-5`, Codex `vd. gpt-5.6-terra`, Antigravity `vd. gemini-3.8-flash-high` (bảng `Record<LocalEngine, string>` thay phép chọn hai nhánh)                                                                                         |
| Hướng dẫn cài ở Cài đặt             | thêm mục 3: `# 3. Antigravity CLI` / `irm https://antigravity.google/cli/install.ps1                                                                                                                                                                                  | iex`/`agy # chạy một lần để đăng nhập`; tiêu đề thành `Bộ não lập trình: Claude Code, Codex và Antigravity`; dòng chờ thành `Đang kiểm tra Claude Code, Codex và Antigravity trên máy…` |
| Chú thích thư mục task              | `Claude Code và Codex` → `Claude Code, Codex và Antigravity`                                                                                                                                                                                                          |

- [ ] **Step 2: Rà mọi phép so sánh provider/engine trong `apps/web/src`** (`Grep "'claude_code'|'codex'"`): chỗ nào rẽ nhánh hai engine local (hiện ô model local, ẩn chọn kết nối…) phải đúng cho `antigravity`; ưu tiên điều kiện `provider !== 'custom_api'` hoặc bảng `Record`.

- [ ] **Step 3: Kiểm tra** — `npm run lint` sạch; `npm run build` rồi `npm run check:bundle` → trong ngân sách.

- [ ] **Step 4: Xem thật** — `node bin/aiteam.mjs --no-open`, mở URL in ra: Cài đặt có ba thẻ, thẻ Antigravity hiện phiên bản `agy` và "đã đăng nhập"; ô model liệt kê model của `agy`; Thêm thành viên chọn được Antigravity.

- [ ] **Step 5: Commit** — `feat(web): show Antigravity as a local engine`

---

### Task 9: Doctor, tài liệu, chạy thật

**Files:**

- Modify: `bin/aiteam.mjs:50,203-209`, `CLAUDE.md` (mục Engine, mục Khi khởi động), `docs/IMPLEMENTATION_PLAN.md`, `docs/UI_MAPPING.md`, `scripts/record-engine-streams.mjs` (chú thích đầu file)

- [ ] **Step 1: Doctor** — thêm `{ label: 'agy --version', outcome: probeCommand('agy --version') }`; dòng trợ giúp thành `Kiểm tra Node, git, Claude Code, Codex, Antigravity`. Chạy `node bin/aiteam.mjs doctor` → có dòng `[ok] agy --version`.

- [ ] **Step 2: `CLAUDE.md`** — mục Engine thêm một gạch đầu dòng cho Antigravity: lệnh gọi đầy đủ (Task 5), quyền qua `--settings` (allow/deny), không dùng `--mode`/sandbox, `denied_actions` + trả lời rỗng = `failed`, ba đường dẫn `.agents/…` bị loại khỏi git ở mọi worktree và bị xoá trước lượt Antigravity, dự án đã commit chúng thì từ chối chạy, cấu hình cấp người dùng `~/.gemini/config` vẫn được nạp (chấp nhận), CLAUDE.md của dự án được đặt đầu prompt. Mục "Chọn model": Antigravity đọc `agy models`. Mục "Khi khởi động": tên tiến trình `claude/codex/agy`.

- [ ] **Step 3: `docs/IMPLEMENTATION_PLAN.md`, `docs/UI_MAPPING.md`** — mọi chỗ liệt kê engine/provider thêm Antigravity (tìm bằng `Grep -i codex docs/`).

- [ ] **Step 4: Kiểm tra toàn bộ** — `npm run lint` && `npm test` && `npm run build` && `npm run check:bundle` && `npm run measure` → tất cả đạt.

- [ ] **Step 5: Chạy thật qua giao diện**
  1. Cài đặt → thẻ Antigravity → "Chạy thử": kết thúc bằng câu tóm tắt README, không có file nào bị tạo.
  2. Tạo agent dev `Antigravity`, quyền `edit_workspace`, trong phòng có leader Claude; tạo task nhỏ ("tạo file hello.txt"), để leader giao cho dev: task của dev hoàn thành, diff có `hello.txt`, leader duyệt được.
  3. Huỷ một task Antigravity đang chạy: trạng thái `cancelled`, không còn tiến trình `agy` (Task Manager).

  Ghi kết quả từng bước vào mô tả PR. Bước nào hỏng: dừng, sửa kèm regression test.

- [ ] **Step 6: Commit** — `docs: document the Antigravity engine; doctor checks agy`

- [ ] **Step 7: PR** — push nhánh, mở PR vào `master` (không merge thẳng), mô tả gồm kết quả kiểm chứng A–H và ba bước chạy thật.
