# Hạn mức engine — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thanh bên hiện hạn mức còn lại của Claude Code / Codex / Antigravity; task (và phiên duyệt cấp trên) hết hạn mức thì tự chờ tới giờ reset rồi chạy tiếp.

**Architecture:** Module `providers` có ba bộ đọc hạn mức (gọi `/usage` hoặc `codex app-server`, 0 token) và một service giữ kết quả trong bộ nhớ, hỏi lại định kỳ, phát live update `engine_quota.changed`. `orchestration` hỏi service qua một cổng khi lượt gặp `RATE_LIMITED`, rồi requeue với `runAfter` = giờ reset. Hàm chọn bucket áp dụng cho model nằm ở `packages/contracts` để server (quyết định chờ) và web (dấu ⚠) dùng chung.

**Tech Stack:** TypeScript, NestJS + Fastify, `node:sqlite`, zod, Vitest, Next.js export, CSS Modules. Không thêm thư viện.

**Spec:** `docs/superpowers/specs/2026-11-11-engine-quota-design.md`

## Global Constraints

- Không thêm dependency (CLAUDE.md "Stack"). React `useSyncExternalStore` là API có sẵn.
- Spawn không qua shell (`resolveCliExecutable` + `spawn`/`execFile`), kill cả cây tiến trình, timeout 20 s.
- Thư mục làm việc khi hỏi hạn mức: `<dataDirectory>/quota-probe/` (tạo nếu thiếu), không bao giờ worktree/thư mục dự án.
- Claude: luôn kèm `--setting-sources "" --settings {"disableAllHooks":true} --strict-mcp-config`. agy: không kèm `--disable-slash-commands`; gọi `clearEngineManagedPaths(probeDir, null)` trước mỗi lần.
- Không log stdout thô, không trả `accountId`; log chỉ engine, state, thời gian.
- Mọi số từ CLI parse bằng zod; `remainingPercent` kẹp 0..100 (số nguyên, làm tròn).
- Giá trị liệt kê mới ở `packages/contracts/src/enumerations.ts`. Migration mới không sửa migration cũ.
- Tên cấm theo `id-denylist` (`execute`, `run`, `handle`, `process`, `data`, `info`, `manager`, `helper`, `util`…).
- Ngưỡng: vàng < 20, đỏ < 10 (theo `remainingPercent`). Hỏi lại mỗi 5 phút; sau lượt agent giãn cách tối thiểu 30 s; đệm sau giờ reset 60 s.
- Chuỗi tiếng Việt cố định (dùng nguyên văn):
  - Ghi chú task chờ: `⏸ Chờ hạn mức <cửa sổ> của <Engine> · tự chạy tiếp lúc <HH:mm dd/MM>`
  - Sự kiện timeline: `dừng vì hết hạn mức <cửa sổ> của <Engine>, tự chạy tiếp lúc <HH:mm dd/MM>`
  - Thanh bên: tiêu đề `Hạn mức còn lại`; trạng thái `⚠ chưa đăng nhập`, `chưa cài`, `không đọc được hạn mức`, `không có hạn mức theo gói`; chân `cập nhật N phút trước`.
- Ngân sách bundle web: code ứng dụng ≤ 70 KB, tổng lần đầu ≤ 230 KB (`npm run check:bundle`).
- Lệnh kiểm tra cuối mỗi task: `npm run lint` và `npm test -- <file test của task>`; task cuối chạy full `npm test`, `npm run build`, `npm run check:bundle`.
- Commit Conventional Commits, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không commit `.superpowers/` và các file gốc chưa theo dõi ở thư mục gốc (`AI_management.bundle`, `IMPLEMENTATION_PLAN.md`, `UI_MAPPING.md`, `index.html`).
- Chạy với Node đã vá (≥ 22.23.4 / 24.22.1 / 26.12.1); trên máy chủ dự án dùng bản portable trong scratchpad như các nhánh trước.

## Review Focus

1. **429 ngắn khi bucket của model khác đã về 0** (agent opus, bucket Fable 0%) → không chờ, giữ backoff cũ. Test ở Task 7 (`does not wait when only another model's bucket is exhausted`).
2. **Giờ reset Claude qua nửa đêm / năm mới / múi giờ khác giờ máy** → giờ UTC đúng. Test ở Task 3.
3. **`/usage` trả lỗi đăng nhập hoặc định dạng lạ** → `not_signed_in` / `unreadable`, giữ số cũ kèm `lastSuccessAt`, không bao giờ 500. Test ở Task 3, 4, 5, 6.
4. **5 giờ và tuần cùng về 0** → chờ tới reset tuần (muộn nhất). Test ở Task 1 và Task 7.
5. **Sau giờ reset vẫn hết (tuần chưa reset)** → chờ tiếp, bộ đếm lỗi engine không tăng, task không `failed`. Test ở Task 7.

---

### Task 1: Contracts — mô hình hạn mức và chọn bucket áp dụng

**Files:**

- Modify: `packages/contracts/src/enumerations.ts`
- Create: `packages/contracts/src/engine-quota.ts`
- Modify: `packages/contracts/src/index.ts` (export)
- Modify: `packages/contracts/src/tracing.ts` (thêm `'engine_quota.changed'` vào `LIVE_UPDATE_TYPES`)
- Test: `packages/contracts/src/engine-quota.test.ts`

**Interfaces:**

- Produces:
  - `ENGINE_QUOTA_STATES = ['ok','not_installed','not_signed_in','unreadable','not_applicable'] as const`, `engineQuotaStateSchema`, type `EngineQuotaState`.
  - `QUOTA_WINDOWS = ['five_hour','weekly','other'] as const`, `quotaWindowSchema`, type `QuotaWindow`.
  - `engineQuotaBucketSchema`: `{ group: string|null (max 80), window: QuotaWindow, windowLabel: string (max 40), remainingPercent: int 0..100, resetsAt: string|null (ISO) , appliesToModels: string[]|null }` — `appliesToModels` null = áp dụng mọi model; khác null = danh sách tiền tố/tên con (chữ thường) để khớp model.
  - `engineQuotaReportSchema`: `{ engine: LocalEngine, state: EngineQuotaState, buckets: EngineQuotaBucket[], checkedAt: string|null, lastSuccessAt: string|null }`; `engineQuotaReportListSchema = z.array(...)`.
  - `QUOTA_WARNING_PERCENT = 20`, `QUOTA_CRITICAL_PERCENT = 10`.
  - `selectApplicableQuotaBuckets(report: EngineQuotaReport, model: string | null): EngineQuotaBucket[]`
  - `findLowestQuotaBucket(buckets: readonly EngineQuotaBucket[]): EngineQuotaBucket | null` (bằng nhau → reset sớm hơn).
  - `findQuotaExhaustion(buckets: readonly EngineQuotaBucket[]): { resetsAt: string; bucket: EngineQuotaBucket } | null` — trong các bucket `remainingPercent === 0` có `resetsAt`, lấy giờ **muộn nhất**; có bucket 0 mà không bucket 0 nào có `resetsAt` → null.
  - `classifyQuotaLevel(remainingPercent: number): 'normal' | 'warning' | 'critical'`.

Quy tắc `selectApplicableQuotaBuckets`: bucket có `appliesToModels === null` luôn áp dụng. Bucket có danh sách: áp dụng khi `model` (chữ thường) chứa một phần tử của danh sách. `model === null` → chỉ bucket `appliesToModels === null`. Nếu report có bucket có danh sách nhưng **không** bucket có danh sách nào khớp model và **không** bucket nào `appliesToModels === null` (trường hợp Antigravity với model lạ) → trả mọi bucket.

- [ ] **Step 1: Viết test hỏng** (`engine-quota.test.ts`)

```ts
const bucket = (over: Partial<EngineQuotaBucket>): EngineQuotaBucket => ({
  group: null,
  window: 'five_hour',
  windowLabel: '5 giờ',
  remainingPercent: 50,
  resetsAt: '2026-11-11T16:59:00.000Z',
  appliesToModels: null,
  ...over,
});
const report = (buckets: EngineQuotaBucket[]): EngineQuotaReport => ({
  engine: 'claude_code',
  state: 'ok',
  buckets,
  checkedAt: null,
  lastSuccessAt: null,
});

it('keeps shared buckets and the model-specific bucket matching the model', () => {
  const fable = bucket({ group: 'Fable', window: 'weekly', appliesToModels: ['fable'] });
  const shared = bucket({});
  expect(selectApplicableQuotaBuckets(report([shared, fable]), 'opus')).toEqual([shared]);
  expect(selectApplicableQuotaBuckets(report([shared, fable]), 'fable')).toEqual([shared, fable]);
  expect(selectApplicableQuotaBuckets(report([shared, fable]), null)).toEqual([shared]);
});
it('falls back to every group when no group matches the model', () => {
  const gemini = bucket({ group: 'Gemini Models', appliesToModels: ['gemini'] });
  const thirdParty = bucket({ group: 'Claude and GPT models', appliesToModels: ['claude', 'gpt'] });
  const all = report([gemini, thirdParty]);
  expect(selectApplicableQuotaBuckets(all, 'claude-opus-4-6-thinking')).toEqual([thirdParty]);
  expect(selectApplicableQuotaBuckets(all, 'argon-1')).toEqual([gemini, thirdParty]);
});
it('waits for the latest reset among exhausted buckets', () => {
  const fiveHour = bucket({ remainingPercent: 0, resetsAt: '2026-11-11T16:59:00.000Z' });
  const weekly = bucket({
    window: 'weekly',
    remainingPercent: 0,
    resetsAt: '2026-11-18T11:59:00.000Z',
  });
  expect(findQuotaExhaustion([fiveHour, weekly])?.resetsAt).toBe('2026-11-18T11:59:00.000Z');
  expect(findQuotaExhaustion([bucket({ remainingPercent: 3 })])).toBeNull();
  expect(findQuotaExhaustion([bucket({ remainingPercent: 0, resetsAt: null })])).toBeNull();
});
it('picks the lowest bucket and classifies levels', () => {
  const low = bucket({ remainingPercent: 9 });
  expect(findLowestQuotaBucket([bucket({ remainingPercent: 73 }), low])).toBe(low);
  expect(findLowestQuotaBucket([])).toBeNull();
  expect([classifyQuotaLevel(20), classifyQuotaLevel(19), classifyQuotaLevel(9)]).toEqual([
    'normal',
    'warning',
    'critical',
  ]);
});
it('rejects percentages outside 0..100', () => {
  expect(engineQuotaBucketSchema.safeParse(bucket({ remainingPercent: 101 })).success).toBe(false);
});
```

- [ ] **Step 2: Chạy, thấy hỏng** — `npm test -- packages/contracts/src/engine-quota.test.ts` → FAIL (module không tồn tại).
- [ ] **Step 3: Hiện thực** các export ở trên; enum ở `enumerations.ts`, schema + hàm ở `engine-quota.ts`, thêm `'engine_quota.changed'` (chú thích: "Hạn mức của một engine cục bộ vừa đọc lại") vào `LIVE_UPDATE_TYPES`. Live update `engine_quota.changed` dùng `taskId/departmentId/agentId/event` = null.
- [ ] **Step 4: Chạy lại** → PASS; `npm run lint` sạch.
- [ ] **Step 5: Commit** `feat(contracts): engine quota model and bucket selection`

---

### Task 2: Bộ đọc hạn mức Antigravity

**Files:**

- Create: `apps/server/src/modules/providers/application/ports/engine-quota-reader.port.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/quota/quota-probe-directory.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/quota/cli-antigravity-quota.reader.ts`
- Create: `apps/server/src/modules/providers/infrastructure/adapters/quota/__fixtures__/antigravity-usage.json` (bản ghi thật đã làm sạch — nội dung ở spec §3.1, đủ 2 nhóm 4 bucket)
- Test: `.../quota/cli-antigravity-quota.reader.test.ts`

**Interfaces:**

- Produces:
  - Port: `export interface EngineQuotaReader { readonly engine: LocalEngine; readEngineQuota(): Promise<EngineQuotaReading>; }` với `type EngineQuotaReading = { state: EngineQuotaState; buckets: EngineQuotaBucket[] }` (không có thời gian; service gắn `checkedAt`). Token DI `ENGINE_QUOTA_READERS` (mảng reader).
  - `prepareQuotaProbeDirectory(dataDirectory: string): Promise<string>` — `mkdir -p <dataDirectory>/quota-probe`, trả đường dẫn tuyệt đối.
  - `parseAntigravityUsage(stdout: string): EngineQuotaReading`
  - `class CliAntigravityQuotaReader implements EngineQuotaReader` (constructor nhận `dataDirectory: string`).

Parse: JSON một dòng (lấy dòng cuối bắt đầu bằng `{`), zod `command.data.groups[].buckets[]`. `window` `'5h'` → `five_hour` / nhãn `5 giờ`; `'weekly'` → `weekly` / `tuần`; khác → `other` / giữ chữ của CLI (cắt 40). `remainingPercent = round(remaining_fraction*100)`. `appliesToModels` từ `description` của nhóm: lấy phần sau `Models within this group:`, tách theo `,`, lấy từ đầu tiên của mỗi tên, chữ thường, bỏ trùng (`"Gemini Flash, Gemini Pro"` → `['gemini']`; `"Claude Opus, Claude Sonnet, GPT-OSS"` → `['claude','gpt-oss']`), rồi thêm tiền tố trước dấu `-` (`gpt-oss` → cũng `gpt`). Không đọc được mô tả → `null`. Đầu ra không có `groups` hoặc `status !== 'SUCCESS'` → `unreadable`; stdout/stderr khớp `/authentication required|sign in|not logged in|unauthori[sz]ed|\b401\b/i` → `not_signed_in`; `ENGINE_NOT_INSTALLED` từ `resolveCliExecutable` → `not_installed`.

Reader: `prepareQuotaProbeDirectory` → `clearEngineManagedPaths(dir, null)` → `execFile(agy, [...leadingArgs, '-p', '/usage', '--output-format', 'json'], { cwd: dir, timeout: 20_000, maxBuffer: 1 MiB, windowsHide: true })`. Không bao giờ throw: mọi lỗi → `unreadable` (trừ hai trường hợp trên).

- [ ] **Step 1: Test hỏng**

```ts
it('reads both groups from a real recording', () => {
  const reading = parseAntigravityUsage(readFixture('antigravity-usage.json'));
  expect(reading.state).toBe('ok');
  expect(reading.buckets).toHaveLength(4);
  expect(reading.buckets[0]).toEqual({
    group: 'Gemini Models',
    window: 'weekly',
    windowLabel: 'tuần',
    remainingPercent: 99,
    resetsAt: '2026-11-17T15:58:30.000Z',
    appliesToModels: ['gemini'],
  });
  expect(reading.buckets[2]?.appliesToModels).toEqual(['claude', 'gpt-oss', 'gpt']);
});
it('reports unreadable output instead of throwing', () => {
  expect(parseAntigravityUsage('not json').state).toBe('unreadable');
  expect(parseAntigravityUsage('{"status":"SUCCESS","command":{"name":"usage"}}').state).toBe(
    'unreadable',
  );
});
it('recognises a signed-out CLI', () => {
  expect(parseAntigravityUsage('error: authentication required').state).toBe('not_signed_in');
});
```

- [ ] **Step 2: Chạy** `npm test -- cli-antigravity-quota.reader` → FAIL.
- [ ] **Step 3: Hiện thực** theo mô tả trên.
- [ ] **Step 4: Chạy** → PASS; lint sạch.
- [ ] **Step 5: Commit** `feat(providers): read Antigravity quota from agy /usage`

---

### Task 3: Bộ đọc hạn mức Claude Code

**Files:**

- Create: `.../quota/cli-claude-quota.reader.ts`
- Create: `.../quota/__fixtures__/claude-usage.json` (bản ghi thật đã làm sạch: bỏ `session_id`, `uuid`, `credential_expires_at`; giữ `result` với 3 dòng hạn mức của spec §3.2 và phần thống kê phía sau)
- Test: `.../quota/cli-claude-quota.reader.test.ts`

**Interfaces:**

- Consumes: `EngineQuotaReader`, `prepareQuotaProbeDirectory` (Task 2).
- Produces: `parseClaudeUsage(stdout: string, now: Date): EngineQuotaReading`, `parseClaudeResetTime(text: string, now: Date): string | null` (vd. `"Nov 11, 11:59pm (Asia/Ho_Chi_Minh)"` → ISO UTC), `class CliClaudeQuotaReader`.

Dòng khớp `/^(.+?):\s*(\d{1,3})% used(?:\s*·\s*resets\s+(.+))?$/`. Nhãn `Current session` → `five_hour`/`5 giờ`, `group: null`, `appliesToModels: null`. `Current week (all models)` → `weekly`/`tuần`, `group: 'Tất cả model'`, `appliesToModels: null`. `Current week (<X>)` khác → `weekly`/`tuần`, `group: X`, `appliesToModels: [X.toLowerCase()]`. Nhãn khác → bỏ. `remainingPercent = 100 - used` (kẹp). Reset: `Mon D, h[:mm]am|pm (IANA)`; lấy lần xuất hiện đầu tiên **sau `now` − 1 phút** (năm của `now`, nếu đã qua thì năm sau); quy đổi giờ địa phương của múi IANA sang UTC bằng `Intl.DateTimeFormat(..., { timeZone })` (tính offset tại thời điểm đó, sửa một vòng cho DST). Múi giờ không hợp lệ hoặc không khớp mẫu → `resetsAt: null`. Không dòng nào khớp: nếu `result` có `/api key|console/i` (không dùng gói) → `not_applicable`, có `/log ?in|sign in|authenticat/i` → `not_signed_in`, còn lại `unreadable`. JSON hỏng → `unreadable`.

Reader: `execFile(claude, [...leadingArgs, '-p', '/usage', '--output-format', 'json', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config'], { cwd: probeDir, timeout 20 s, ... })`. Dùng lại hằng `FLAG_SETTINGS` bằng cách export nó từ `claude-code-cli.engine.ts` (không chép chuỗi).

- [ ] **Step 1: Test hỏng**

```ts
const NOW = new Date('2026-11-11T16:28:00.000Z'); // 23:28 Asia/Ho_Chi_Minh
it('reads session and weekly lines from a real recording', () => {
  const reading = parseClaudeUsage(readFixture('claude-usage.json'), NOW);
  expect(reading.state).toBe('ok');
  expect(reading.buckets).toEqual([
    {
      group: null,
      window: 'five_hour',
      windowLabel: '5 giờ',
      remainingPercent: 73,
      resetsAt: '2026-11-11T16:59:00.000Z',
      appliesToModels: null,
    },
    {
      group: 'Tất cả model',
      window: 'weekly',
      windowLabel: 'tuần',
      remainingPercent: 95,
      resetsAt: '2026-11-18T11:59:00.000Z',
      appliesToModels: null,
    },
    {
      group: 'Fable',
      window: 'weekly',
      windowLabel: 'tuần',
      remainingPercent: 100,
      resetsAt: '2026-11-18T12:00:00.000Z',
      appliesToModels: ['fable'],
    },
  ]);
});
it('rolls reset dates over midnight and the new year', () => {
  expect(parseClaudeResetTime('Nov 12, 12:30am (Asia/Ho_Chi_Minh)', NOW)).toBe(
    '2026-11-11T17:30:00.000Z',
  );
  expect(parseClaudeResetTime('Jan 2, 9am (UTC)', new Date('2026-12-30T00:00:00Z'))).toBe(
    '2027-01-02T09:00:00.000Z',
  );
  expect(parseClaudeResetTime('Nov 18, 7pm (America/New_York)', NOW)).toBe(
    '2026-11-19T00:00:00.000Z',
  );
  expect(parseClaudeResetTime('Nov 18, 7pm (Mars/Base)', NOW)).toBeNull();
});
it('never invents numbers', () => {
  expect(parseClaudeUsage('{"result":"Something new"}', NOW).state).toBe('unreadable');
  expect(
    parseClaudeUsage('{"result":"Current session: 140% used"}', NOW).buckets[0]?.remainingPercent,
  ).toBe(0);
  expect(parseClaudeUsage('garbage', NOW).state).toBe('unreadable');
});
```

- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực**.
- [ ] **Step 4: Chạy** → PASS; lint sạch.
- [ ] **Step 5: Commit** `feat(providers): read Claude Code quota from /usage`

---

### Task 4: Bộ đọc hạn mức Codex (app-server)

**Files:**

- Modify: `apps/server/src/modules/providers/infrastructure/adapters/engines/cli-process.ts` (thêm `keepStdinOpen?: boolean` vào `CliInvocation`)
- Create: `.../quota/cli-codex-quota.reader.ts`
- Create: `.../quota/__fixtures__/codex-rate-limits.jsonl` (các dòng stdout thật: phản hồi `id:1`, notification `remoteControl/status/changed`, phản hồi `id:2` của spec §3.3; đã bỏ `accountId`, `installationId`, `userAgent`, `id` của credit)
- Test: `.../quota/cli-codex-quota.reader.test.ts`, thêm 1 test vào `cli-process` nếu đã có file test, nếu không thì test trong reader qua fake.

**Interfaces:**

- Consumes: `streamCliOutput`, `resolveCliExecutable`, `prepareQuotaProbeDirectory`.
- Produces: `CODEX_QUOTA_REQUEST_LINES: readonly string[]` (3 dòng JSON-RPC: `initialize` với `clientInfo {name:'aiteam', version}`, notification `initialized`, request `{"id":2,"method":"account/rateLimits/read"}`), `parseCodexRateLimitLine(line: string): EngineQuotaReading | null` (null = không phải dòng `id` 2), `class CliCodexQuotaReader`.

`keepStdinOpen: true` → `child.stdin.write(stdinText)` thay cho `end` (app-server thoát ngay khi stdin EOF mà chưa trả lời — đã thử). `finally` vốn kill cây tiến trình khi consumer `break`.

Reader: `streamCliOutput({ executable, args: ['app-server'], workingDirectory: probeDir, stdinText: lines.join('\n') + '\n', keepStdinOpen: true }, AbortSignal.timeout(20_000))`; đọc tới khi `parseCodexRateLimitLine` trả khác null rồi `break`. Không có dòng nào (hết giờ/thoát) → `unreadable`.

Parse dòng `id` 2: có `error` → message khớp `/401|unauthori[sz]ed|sign in|refresh token|log ?in/i` → `not_signed_in`, còn lại `unreadable`. Có `result`: snapshot = mọi giá trị của `rateLimitsByLimitId` (null → `[rateLimits]`). Mỗi snapshot, mỗi `primary`/`secondary` khác null → bucket: `group = limitName ?? limitId ?? null`, `remainingPercent = 100 - usedPercent`, `resetsAt = resetsAt * 1000 → ISO` (epoch giây), `appliesToModels: null`, `window`: `windowDurationMins` 300 → `five_hour`/`5 giờ`, 10080 → `weekly`/`tuần`, khác → `other` với nhãn `N giờ` (chia hết 60, < 1440) hoặc `N ngày`. `rateLimitReachedType` khác null → mọi bucket của snapshot đó coi như `remainingPercent: 0`. Không bucket nào → `not_applicable`. Không bao giờ đưa `accountId` vào kết quả.

- [ ] **Step 1: Test hỏng**

```ts
it('reads primary and secondary windows from a real recording', () => {
  const readings = readFixtureLines('codex-rate-limits.jsonl')
    .map(parseCodexRateLimitLine)
    .filter(Boolean);
  expect(readings).toHaveLength(1);
  expect(readings[0]).toEqual({
    state: 'ok',
    buckets: [
      {
        group: 'codex',
        window: 'five_hour',
        windowLabel: '5 giờ',
        remainingPercent: 100,
        resetsAt: new Date(1794433541 * 1000).toISOString(),
        appliesToModels: null,
      },
      {
        group: 'codex',
        window: 'weekly',
        windowLabel: 'tuần',
        remainingPercent: 97,
        resetsAt: new Date(1794446113 * 1000).toISOString(),
        appliesToModels: null,
      },
    ],
  });
});
it('treats a reached limit as exhausted', () => {
  const line = JSON.stringify({
    id: 2,
    result: {
      rateLimits: {
        limitId: 'codex',
        rateLimitReachedType: 'rate_limit_reached',
        primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 1794433541 },
        secondary: null,
      },
      rateLimitsByLimitId: null,
    },
  });
  expect(parseCodexRateLimitLine(line)?.buckets[0]?.remainingPercent).toBe(0);
});
it('maps a broken login to not_signed_in', () => {
  const line =
    '{"id":2,"error":{"code":-32603,"message":"failed to fetch codex rate limits: 401 Unauthorized"}}';
  expect(parseCodexRateLimitLine(line)?.state).toBe('not_signed_in');
});
it('ignores other lines', () => {
  expect(parseCodexRateLimitLine('{"id":1,"result":{}}')).toBeNull();
});
```

- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực** (cli-process + reader).
- [ ] **Step 4: Chạy** reader test và các test engine hiện có (`npm test -- engines`) → PASS.
- [ ] **Step 5: Commit** `feat(providers): read Codex rate limits through app-server`

---

### Task 5: Service hạn mức, API và live update

**Files:**

- Create: `apps/server/src/modules/providers/application/use-cases/engine-quota-monitor.ts`
- Create: `apps/server/src/modules/providers/presentation/controllers/engine-quota.controller.ts`
- Create: `apps/server/src/modules/orchestration/application/ports/engine-quota.port.ts`
- Modify: `apps/server/src/modules/providers/providers.module.ts` (DI, controller, export `ENGINE_QUOTA_GATEWAY`)
- Modify: `apps/server/src/shared/runtime/local-engine-adapters-override.ts` (thêm `quotaReaders?: EngineQuotaReader[]`)
- Modify: test harness đang dựng `localEngineAdaptersOverride` (tìm `localEngineAdaptersOverride` trong `apps/server/test`/`src`) để mặc định dùng reader giả trả `not_installed`
- Test: `.../use-cases/engine-quota-monitor.test.ts`, e2e controller theo mẫu test controller providers hiện có

**Interfaces:**

- Consumes: `EngineQuotaReader`, `ENGINE_QUOTA_READERS` (Task 2–4), `LiveUpdateHub.publishLiveUpdate`, `APP_LOGGER`.
- Produces:
  - Cổng orchestration (`engine-quota.port.ts`): `ENGINE_QUOTA_GATEWAY` +
    ```ts
    export interface EngineQuotaGateway {
      /** Reads the engine's quota now (skips the 30 s spacing); never rejects. */
      readFreshEngineQuota(engine: LocalEngine): Promise<EngineQuotaReport>;
      /** Asks for a re-read soon (spaced ≥ 30 s per engine); returns at once. */
      requestEngineQuotaRefresh(engine: LocalEngine): void;
    }
    ```
  - `class EngineQuotaMonitor implements EngineQuotaGateway, OnModuleInit, OnModuleDestroy` với thêm `listEngineQuotas(): EngineQuotaReport[]` (thứ tự `claude_code, codex, antigravity`; engine chưa đọc lần nào → `state: 'unreadable'`, `checkedAt: null`) và `refreshAllEngineQuotas(): Promise<EngineQuotaReport[]>`.
  - API: `GET /api/local-engines/quota` → `EngineQuotaReport[]`; `POST /api/local-engines/quota/refresh` → đọc lại cả ba, trả `EngineQuotaReport[]`. (Route `quota` phải đăng ký trước `:engine/...` hoặc ở controller riêng cùng tiền tố — kiểm tra không đụng `GET /api/local-engines/:engine/models`.)

Hành vi monitor: một promise đang chạy mỗi engine (gọi chồng nhau dùng chung); kết quả `ok`/`not_applicable` cập nhật `buckets` + `lastSuccessAt`; `unreadable` giữ `buckets` + `lastSuccessAt` cũ; `not_installed`/`not_signed_in` xoá buckets. Sau mỗi lần đọc xong phát `publishLiveUpdate({ type: 'engine_quota.changed', taskId: null, departmentId: null, agentId: null, event: null })`. `onModuleInit`: `void refreshAllEngineQuotas()` rồi `setInterval(…, 300_000).unref()` — **chỉ khi** không có override (test không hẹn giờ; dùng cờ inject giống `TASK_SCHEDULER_ENABLED`). `requestEngineQuotaRefresh`: bỏ qua nếu lần đọc gần nhất < 30 s, còn lại đọc. Reader ném lỗi bất ngờ → log `warn` (engine, code) và `unreadable`. Log mỗi lần đọc: `{ engine, state, durationMs }` mức debug.

- [ ] **Step 1: Test hỏng** (reader giả, đồng hồ giả của Vitest)

```ts
it('shares one read per engine and keeps the last good numbers when a read fails', async () => {
  const reader = fakeReader('claude_code', [okReading(73), { state: 'unreadable', buckets: [] }]);
  const monitor = createMonitor([reader]);
  await Promise.all([
    monitor.readFreshEngineQuota('claude_code'),
    monitor.readFreshEngineQuota('claude_code'),
  ]);
  expect(reader.calls).toBe(1);
  const report = await monitor.readFreshEngineQuota('claude_code');
  expect(report.state).toBe('unreadable');
  expect(report.buckets[0]?.remainingPercent).toBe(73);
  expect(report.lastSuccessAt).not.toBeNull();
});
it('spaces refresh requests 30 s apart and announces each read', async () => {
  /* 2 requests in 10 s → 1 read; after 31 s → 2; publishLiveUpdate called per read with type engine_quota.changed */
});
it('lists engines in a fixed order, never-read engines as unreadable', () => {
  /* listEngineQuotas() engines = ['claude_code','codex','antigravity'] */
});
it('turns a throwing reader into unreadable', async () => {
  /* reader rejects → state unreadable, no rejection */
});
```

E2E: `GET /api/local-engines/quota` trả 3 phần tử đúng schema; `GET /api/local-engines/claude_code/models` vẫn chạy.

- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực** monitor, controller, cổng, DI (`ENGINE_QUOTA_READERS` = override ?? `[CliClaudeQuotaReader, CliCodexQuotaReader, CliAntigravityQuotaReader]` khởi tạo với `runtimeConfig.dataDirectory`; `ENGINE_QUOTA_GATEWAY` `useExisting: EngineQuotaMonitor`), override.
- [ ] **Step 4: Chạy** test mới + `npm test -- providers` → PASS.
- [ ] **Step 5: Commit** `feat(providers): engine quota monitor and API`

---

### Task 6: Thanh bên hiện hạn mức và ⚠ trên agent

**Files:**

- Create: `apps/web/src/features/providers/engine-quota-store.ts`
- Create: `apps/web/src/features/providers/components/engine-quota-card.tsx` + `engine-quota-card.module.css`
- Modify: `apps/web/src/features/providers/providers-api.ts` (`loadEngineQuotas`, `refreshEngineQuotas`)
- Modify: `apps/web/src/shared/layout/app-sidebar.tsx` (đặt `<EngineQuotaCard />` trong `sidebarFooter`, trước `UsageTodayCard`)
- Modify: `apps/web/src/features/organization/components/agent-identity.tsx` (`ProviderBadge` nhận thêm `model?: string | null`)
- Modify: 3 chỗ dùng `ProviderBadge` (`org-tree-view.tsx:71`, `agent-detail-panel.tsx:150`, `overview/components/agent-table.tsx:175`) truyền `model={agent.model}`
- Test: theo cách test web hiện có (nếu `apps/web` có Vitest cho hàm thuần thì test `describeEngineQuota`; nếu không, hàm thuần đặt trong contracts/web và test cùng Task 1)

**Interfaces:**

- Consumes: `EngineQuotaReport`, `findLowestQuotaBucket`, `selectApplicableQuotaBuckets`, `classifyQuotaLevel` (Task 1); API Task 5; `useEventStream('/api/stream/workspace', …)`.
- Produces:
  - `useEngineQuotas(): { reports: EngineQuotaReport[] | null; refresh: () => void; refreshing: boolean }` — store cấp module (một lần tải cho cả trang dù nhiều component dùng), `useSyncExternalStore`; tải lần đầu khi có subscriber đầu tiên; tải lại khi workspace stream có `engine_quota.changed`; tải lại mỗi 60 s để chữ "cập nhật N phút trước" đúng.
  - `describeEngineQuota(report: EngineQuotaReport, now: Date): { headline: string; level: 'normal'|'warning'|'critical'|'muted'; percent: number | null }` — headline vd. `73% · 5 giờ · reset 23:59` (giờ máy; khác ngày thêm ` dd/MM`); state khác `ok` dùng chuỗi cố định của Global Constraints; `unreadable` có số cũ → `không đọc được hạn mức · số lúc HH:mm`, `level: 'muted'`.

Card: tiêu đề `Hạn mức còn lại`; mỗi engine một dòng (nhãn và màu từ `PROVIDER_PRESENTATION`), thanh ngang theo `percent`, màu thanh: normal = màu engine, warning = vàng, critical = đỏ (token màu có sẵn trong CSS variables; thêm token nếu thiếu, cả theme sáng/tối). Bấm dòng → `<details>`-style mở danh sách mọi bucket (`group · cửa sổ · N% · reset …`). Chân: `cập nhật N phút trước` (theo `checkedAt` mới nhất) + nút ↻ (`aria-label="Đọc lại hạn mức"`, disabled khi `refreshing`). Thanh bên thu gọn/màn hẹp: chỉ giữ chấm màu theo level + tên viết tắt (`mark` của presentation).

`ProviderBadge` khi `model` được truyền và engine là local: lấy report của engine, `selectApplicableQuotaBuckets(report, model)`, bucket thấp nhất `critical` → thêm ` ⚠` sau nhãn, `title="Hạn mức <cửa sổ> của <Engine> còn N% · reset HH:mm dd/MM"`. Custom API không đổi.

- [ ] **Step 1: Test hỏng** cho `describeEngineQuota` (ok/warning/critical/not_signed_in/unreadable có số cũ/không có số).
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực** store, card, badge.
- [ ] **Step 4: Chạy** test; `npm run lint`; `npm run build && npm run check:bundle` → trong ngân sách.
- [ ] **Step 5: Commit** `feat(web): show engine quota in the sidebar and warn on agents`

---

### Task 7: Lượt agent hết hạn mức thì chờ tới giờ reset

**Files:**

- Modify: `apps/server/src/modules/orchestration/application/use-cases/finish-task-turn.use-case.ts` (`handleEngineFailure`, gọi `requestEngineQuotaRefresh` sau mỗi lượt của engine cục bộ)
- Create: `apps/server/src/modules/orchestration/application/use-cases/quota-wait-planner.ts`
- Modify: `apps/server/src/modules/orchestration/domain/entities/task.ts` (`waitForQuota`)
- Modify: `apps/server/src/modules/tracing/domain/describe-task-event.ts` (case `quota_wait`)
- Modify: orchestration module DI (inject `ENGINE_QUOTA_GATEWAY` từ ProvidersModule — đã export ở Task 5) và fake trong test harness
- Test: `finish-task-turn.use-case.test.ts` (hoặc file test orchestration hiện có cho nhánh engine failure), `quota-wait-planner.test.ts`

**Interfaces:**

- Consumes: `EngineQuotaGateway` (Task 5), `selectApplicableQuotaBuckets`, `findQuotaExhaustion` (Task 1), `TaskCheckpoints.saveTaskCheckpoint`.
- Produces:
  - `QUOTA_RESUME_MARGIN_MS = 60_000`
  - `class QuotaWaitPlanner { planQuotaWait(snapshot: { provider: AgentProvider; model: string | null }): Promise<QuotaWait | null> }` với `QuotaWait = { runAfter: string; engineLabel: string; windowLabel: string }`. `provider === 'custom_api'` → null. Đọc `readFreshEngineQuota`, `state !== 'ok'` → null, rồi `findQuotaExhaustion(selectApplicableQuotaBuckets(report, model))` → null hoặc `runAfter = resetsAt + 60 s`. `engineLabel`: `Claude Code` / `Codex` / `Antigravity`.
  - `formatQuotaResumeTime(iso: string): string` → `HH:mm dd/MM` giờ máy (dùng cho note và event).
  - `Task.waitForQuota(input: { runAfter: string; note: string }): void` — `status = 'queued'`, `runAfter`, `statusNote = note`; **không** đổi `stepAttempt`, `currentStepId`, `sessionRef`, `engineFailures`.

Luồng mới trong `handleEngineFailure` (chỉ khi `terminal.code === 'RATE_LIMITED'` và `state.engineSnapshot` là engine cục bộ): `planQuotaWait(state.engineSnapshot)`; có kết quả → `await saveTaskCheckpoint(task, 'aiteam: lưu mốc khi hết hạn mức')`, record event `quota_wait` payload `{ engine, windowLabel, runAfter, code, message }`, `task.waitForQuota({ runAfter, note: '⏸ Chờ hạn mức <cửa sổ> của <Engine> · tự chạy tiếp lúc <HH:mm dd/MM>' })`, return (không `countEngineFailure`). Không có → nhánh cũ. `handleEngineFailure` thành `async`; caller `await`. `describe-task-event` cho `quota_wait`: `dừng vì hết hạn mức <windowLabel> của <engine>, tự chạy tiếp lúc <HH:mm dd/MM>` (format từ `runAfter`).

Sau mọi lượt kết thúc (completed/failed/cancelled) với engine snapshot cục bộ: `quotaGateway.requestEngineQuotaRefresh(engine)` (không await).

- [ ] **Step 1: Test hỏng**

```ts
it('waits until the latest applicable reset without counting a failure', async () => {
  quotaGateway.nextReport = report('claude_code', [
    bucket({ remainingPercent: 0, resetsAt: '2026-11-11T16:59:00.000Z' }),
    bucket({ window: 'weekly', windowLabel: 'tuần', remainingPercent: 40, resetsAt: '2026-11-18T11:59:00.000Z' }),
  ]);
  await finishWithFailure(task /* snapshot claude_code, model 'opus', sessionRef 's-1' */, 'RATE_LIMITED');
  const saved = repository.findTaskById(task.id)!.toState();
  expect(saved.status).toBe('queued');
  expect(saved.runAfter).toBe('2026-11-11T17:00:00.000Z');
  expect(saved.engineFailures).toBe(0);
  expect(saved.sessionRef).toBe('s-1');
  expect(saved.statusNote).toMatch(/^⏸ Chờ hạn mức 5 giờ của Claude Code · tự chạy tiếp lúc /);
  expect(checkpoints.messages).toContain('aiteam: lưu mốc khi hết hạn mức');
  expect(eventKinds()).toContain('quota_wait');
});
it('does not wait when only another model's bucket is exhausted', async () => {
  quotaGateway.nextReport = report('claude_code', [
    bucket({ remainingPercent: 60 }),
    bucket({ group: 'Fable', window: 'weekly', remainingPercent: 0, appliesToModels: ['fable'] }),
  ]);
  await finishWithFailure(task /* model 'opus' */, 'RATE_LIMITED');
  expect(repository.findTaskById(task.id)!.toState().engineFailures).toBe(1); // old back-off
});
it('keeps waiting when the quota is still exhausted after the reset', async () => { /* two RATE_LIMITED in a row with exhausted weekly → still queued, engineFailures 0, never failed */ });
it('keeps the old back-off when the quota cannot be read', async () => { /* state unreadable → runAfter = now + 30 s, engineFailures 1 */ });
it('ignores Custom API failures', async () => { /* provider custom_api → gateway not called */ });
```

- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực**.
- [ ] **Step 4: Chạy** test orchestration (`npm test -- orchestration`) → PASS.
- [ ] **Step 5: Commit** `feat(orchestration): wait for the quota reset instead of failing`

---

### Task 8: Phiên duyệt cấp trên hết hạn mức thì chờ rồi duyệt lại

**Files:**

- Create: `apps/server/src/shared/database/migrations/014_task_review_pending.sql` (+ đăng ký version 14 `task-review-pending` trong `migrations/index.ts`, không `rebuildsTables`)
- Create: `.../migrations/014-task-review-pending.test.ts` (theo mẫu `013-antigravity-engine.test.ts`)
- Modify: `scripts/smoke-test-dist.mjs` (danh sách migration 1..14)
- Modify: `apps/server/src/modules/orchestration/domain/entities/task.ts` (`reviewPending: boolean` trong `TaskState`, `waitForReviewQuota`, `takePendingReview`)
- Modify: `apps/server/src/modules/orchestration/infrastructure/persistence/sqlite-task.repository.ts` (đọc/ghi cột)
- Modify: `apps/server/src/modules/orchestration/application/use-cases/step-review-launcher.ts` (`finishStepReview`)
- Modify: `apps/server/src/modules/orchestration/application/use-cases/start-task-turn.use-case.ts` (`beginTurn`: nhánh mở lại phiên duyệt)
- Test: test `step-review-launcher` / e2e orchestration hiện có cho cổng `lead_approval`

**Interfaces:**

- Consumes: `QuotaWaitPlanner`, `formatQuotaResumeTime` (Task 7), `TaskEventLog.listStepReports`, `TaskWorkspace.prepareTaskWorkspace` (idempotent), `StepReviewLauncher.startStepReview`.
- Produces:
  - SQL: `ALTER TABLE tasks ADD COLUMN review_pending INTEGER NOT NULL DEFAULT 0 CHECK (review_pending IN (0, 1));`
  - `Task.waitForReviewQuota(input: { runAfter: string; note: string }): void` — `status 'queued'`, `runAfter`, `statusNote`, `reviewPending = true`.
  - `Task.takePendingReview(): boolean` — trả giá trị cũ rồi đặt `false`.
  - Mọi thao tác khác đưa task khỏi hàng chờ đó (huỷ, xoá, `fail`, `pause`→`resume` vẫn giữ cờ để duyệt lại; `requeue` từ nơi khác đặt `false`).

`finishStepReview`: khi `terminal.kind === 'failed' && terminal.code === 'RATE_LIMITED'`, lấy snapshot người duyệt (`staffDirectory.readEngineSnapshot(reviewer.agentId)`), `planQuotaWait`; có kết quả → event `quota_wait` (thêm `reviewerName` vào payload), `task.waitForReviewQuota(...)` (note dùng nguyên chuỗi của Task 7), `updateTask`, return. Không có → `askUserInstead` như cũ.

`beginTurn`: sau kiểm tra `queued`, nếu `task.takePendingReview()`: tìm `step` hiện tại; report cuối `listStepReports(taskId).at(-1)` (cần `agentId`, `agentName`, `summary`; nếu `StepReportRecord` thiếu `agentId` thì bổ sung từ event) ; `prepareTaskWorkspace` lấy `agentDirectory`; `updateTask`; gọi `reviewLauncher.startStepReview(task, step, worker, summary, agentDirectory)`; return. Thiếu step/report → `requeue` bình thường (lượt worker chạy lại) và ghi log `warn`.

- [ ] **Step 1: Test hỏng**: migration thêm cột mặc định 0 và `CHECK` từ chối 2; review `RATE_LIMITED` + bucket 0 → task `queued`, `reviewPending` true, không có approval request; lượt kế tiếp `beginTurn` gọi `startStepReview` (fake engine nhận prompt duyệt, không phải prompt worker) và cờ về false; review `RATE_LIMITED` không có bucket 0 → approval request như cũ.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực**.
- [ ] **Step 4: Chạy** test migration + orchestration + `enumerations.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(orchestration): superior reviews wait for the quota reset too`

---

### Task 9: Đổi engine hoặc người nhận khi đang chờ thì chạy ngay

**Files:**

- Modify: `apps/server/src/modules/orchestration/infrastructure/adapters/agent-reconfiguration.subscriber.ts`
- Modify: `apps/server/src/modules/orchestration/domain/repositories/task.repository.ts` + sqlite impl (`listQueuedTaskIdsAssignedTo(agentId: string): string[]`)
- Modify: `apps/server/src/modules/orchestration/domain/entities/task.ts` (`clearRunAfter(): void`; `assignTo` gọi nó khi `status === 'queued'`)
- Test: test subscriber (theo mẫu test hiện có của subscriber nếu có) + test entity

**Interfaces:**

- Consumes: `AgentConfigurationChanged.changes[].field`.
- Produces: `Task.clearRunAfter()` — `runAfter = null`; nếu `statusNote` bắt đầu bằng `⏸ Chờ hạn mức` thì `statusNote = null`.

Subscriber: ngoài nhánh `reducesPermissions` hiện có, khi `changes` có `provider`, `connectionId` hoặc `model`: với mỗi id trong `listQueuedTaskIdsAssignedTo(agentId)` → `clearRunAfter()` + `updateTask`. (Cần inject `TASK_REPOSITORY`.)

- [ ] **Step 1: Test hỏng**: task chờ hạn mức của agent A, phát `AgentConfigurationChanged` đổi `provider` → `runAfter` null, note bị xoá; đổi `accessLevel` không giảm quyền → `runAfter` giữ nguyên; `delegateTask` sang agent B → `runAfter` null.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Hiện thực**.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(orchestration): run a quota-waiting task at once after an engine change`

---

### Task 10: Tài liệu, script ghi bản thật, kiểm thử thật

**Files:**

- Modify: `scripts/record-engine-streams.mjs` (nhóm `quota`: chạy 3 lệnh ở spec §3, làm sạch `accountId`/`session_id`/`uuid`/`credential_expires_at`/`installationId`/`userAgent`/id credit, ghi vào `.../quota/__fixtures__/`)
- Modify: `CLAUDE.md` (mục Engine: một đoạn "Hạn mức engine" — ba lệnh, cờ an toàn, thư mục `quota-probe`, quy tắc chờ), `docs/IMPLEMENTATION_PLAN.md`, `docs/UI_MAPPING.md` (thanh bên → `GET/POST /api/local-engines/quota` → `EngineQuotaMonitor`)

- [ ] **Step 1:** Chạy `node scripts/record-engine-streams.mjs quota` trên máy chủ dự án; `git diff` fixture chỉ khác số/giờ, không lộ id; contract test Task 2–4 vẫn PASS (cập nhật số kỳ vọng nếu đổi theo bản ghi mới).
- [ ] **Step 2:** Full kiểm tra: `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle`, `npm run measure` → tất cả đạt (ghi số đo).
- [ ] **Step 3:** Chạy thật (AITEAM_HOME riêng trong scratchpad, `node bin/aiteam.mjs --no-open --port 7533`): thanh bên hiện cả 3 engine với số khớp `/usage` tay; nút ↻ đọc lại; trong lúc đọc hạn mức, `codex app-server` không có tiến trình con và không có `hermes.exe` mới; giả lập hết hạn mức bằng engine giả trong e2e (không cố tạo hết hạn mức thật).
- [ ] **Step 4:** Commit `docs: engine quota rules and recorded quota fixtures`

---

## Ghi chú cho người thực thi

- Thứ tự phụ thuộc: 1 → (2, 3, 4) → 5 → (6, 7) → 8 → 9 → 10. Task 2–4 độc lập với nhau sau Task 1 (Task 3, 4 dùng `prepareQuotaProbeDirectory` của Task 2).
- `StepReportRecord`: kiểm tra có `agentId` chưa trước khi làm Task 8; nếu thiếu, thêm vào port và repository (dữ liệu có sẵn ở cột `agent_id` của event).
- Nếu test harness e2e khởi tạo `ProvidersModule` thật, mặc định override `quotaReaders` bằng reader giả `not_installed` để test không spawn CLI thật (bài học từ nhánh Antigravity: "keep provider e2e tests independent of installed CLIs").
