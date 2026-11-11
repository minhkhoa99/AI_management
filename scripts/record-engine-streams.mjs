#!/usr/bin/env node
// Records real JSONL streams from the local Claude Code, Codex and Antigravity (agy) CLIs,
// sanitises them, and writes them as contract-test fixtures. Re-run when a CLI changes its output format.
//
//   node scripts/record-engine-streams.mjs [claude|codex|antigravity|quota|all] [fixture-name]
//
// Spends a little of the signed-in accounts' quota (a few tiny prompts, cheapest models).
// The `quota` group only runs the three quota-reading commands (0 tokens) and writes the fixtures
// next to the quota readers; `all` does NOT include it (it is not an agent turn). Set
// AITEAM_QUOTA_FIXTURE_DIR to write them elsewhere. A quota recording changes the numbers and
// reset times: update the expected values (and the injected `now` of the Claude test) to match.
// Sanitising removes: personal paths, session/thread ids, account and quota details, hooks.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = path.join(
  repositoryRoot,
  'apps/server/src/modules/providers/infrastructure/adapters/engines/__fixtures__',
);

const quotaFixtureDirectory =
  process.env.AITEAM_QUOTA_FIXTURE_DIR ??
  path.join(
    repositoryRoot,
    'apps/server/src/modules/providers/infrastructure/adapters/quota/__fixtures__',
  );

const READ_PROMPT =
  'Đọc README.md trong thư mục hiện tại rồi tóm tắt nội dung trong một câu tiếng Việt.';
const EDIT_PROMPT = 'Tạo file hello.txt chứa đúng một dòng: xin chào. Không làm gì khác.';
const MODIFY_PROMPT =
  'Trong README.md, đổi chữ "TypeScript" thành "JavaScript" bằng công cụ Edit. Không làm gì khác.';
const LONG_PROMPT = 'Đọc README.md, sau đó viết một bài luận 2000 từ về lịch sử ghi chú.';

// Same isolation flags as ClaudeCodeCliEngine / CodexCliEngine.
const CLAUDE_BASE = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--setting-sources',
  'project,local',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--model',
  'claude-haiku-5-5',
];
const CODEX_BASE = [
  'exec',
  '--json',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--ephemeral',
];

// Same flags as the Antigravity engine; the settings JSON (--settings, inline) is appended per recording.
const AGY_BASE = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--disable-slash-commands',
  '--model',
  'gemini-3.8-flash-low',
];
// Hardcoded copies of buildAntigravitySettings() output (this script cannot import TypeScript).
const AGY_NETWORK_DENIES = [
  'read_url(*)',
  'command(regex:(?is).*curl.*)',
  'command(regex:(?is).*wget.*)',
  'command(regex:(?is).*Invoke-WebRequest.*)',
];
const AGY_DANGEROUS_DENIES = [
  'command(regex:(?is).*rm[[:space:]]+-rf.*)',
  'command(regex:(?is).*git[[:space:]]+push.*)',
  'command(regex:(?is).*git[[:space:]]+reset[[:space:]]+--hard.*)',
  'command(regex:(?is).*npm[[:space:]]+publish.*)',
  'command(regex:(?is).*Remove-Item.*)',
];
const AGY_MANAGED_WRITE_DENIES = ['.agents', '.agent', '_agents', '_agent', '.gemini'].flatMap(
  (folder) => [`write_file(${folder}/)`, `write_file(${folder})`],
);
const AGY_READ_ONLY_SETTINGS = JSON.stringify({
  allowNonWorkspaceAccess: false,
  permissions: {
    allow: [],
    deny: [
      'mcp(*)',
      'execute_url(*)',
      'write_file(*)',
      'command(*)',
      ...AGY_NETWORK_DENIES,
      ...AGY_DANGEROUS_DENIES,
    ],
  },
});
const AGY_EDIT_SETTINGS = JSON.stringify({
  allowNonWorkspaceAccess: false,
  permissions: {
    allow: ['command(*)'],
    deny: [
      'mcp(*)',
      'execute_url(*)',
      ...AGY_MANAGED_WRITE_DENIES,
      ...AGY_NETWORK_DENIES,
      ...AGY_DANGEROUS_DENIES,
    ],
  },
});
// agy reads one stream-json user event from stdin instead of the bare prompt.
const agyStdin = (prompt) => JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
const COMMAND_PROMPT = 'Chạy lệnh: node --version. Không làm gì khác.';

const RECORDINGS = {
  claude: [
    [
      'claude-read-only',
      'claude',
      [
        ...CLAUDE_BASE,
        '--permission-mode',
        'default',
        '--disallowedTools',
        'Write',
        'Edit',
        'Bash',
        'PowerShell',
      ],
      READ_PROMPT,
    ],
    ['claude-edit', 'claude', [...CLAUDE_BASE, '--permission-mode', 'acceptEdits'], EDIT_PROMPT],
    [
      'claude-modify',
      'claude',
      [...CLAUDE_BASE, '--permission-mode', 'acceptEdits'],
      MODIFY_PROMPT,
    ],
    [
      'claude-cancelled',
      'claude',
      [...CLAUDE_BASE, '--permission-mode', 'default'],
      LONG_PROMPT,
      6000,
    ],
    [
      'claude-invalid-model',
      'claude',
      [...CLAUDE_BASE.slice(0, -2), '--model', 'claude-model-that-does-not-exist'],
      'Chào',
    ],
  ],
  antigravity: [
    [
      'antigravity-read-only',
      'agy',
      [...AGY_BASE, '--settings', AGY_READ_ONLY_SETTINGS],
      READ_PROMPT,
      undefined,
      agyStdin,
    ],
    [
      'antigravity-edit',
      'agy',
      [...AGY_BASE, '--settings', AGY_EDIT_SETTINGS],
      `${EDIT_PROMPT} Sau đó chạy lệnh: node --version`,
      undefined,
      agyStdin,
    ],
    [
      'antigravity-denied-command',
      'agy',
      [...AGY_BASE, '--settings', AGY_READ_ONLY_SETTINGS],
      COMMAND_PROMPT,
      undefined,
      agyStdin,
    ],
    [
      'antigravity-cancelled',
      'agy',
      [...AGY_BASE, '--settings', AGY_READ_ONLY_SETTINGS],
      LONG_PROMPT,
      15000,
      agyStdin,
    ],
    [
      'antigravity-invalid-model',
      'agy',
      [...AGY_BASE.slice(0, -1), 'model-that-does-not-exist', '--settings', AGY_READ_ONLY_SETTINGS],
      'Chào',
      undefined,
      agyStdin,
    ],
  ],
  codex: [
    ['codex-read-only', 'codex', [...CODEX_BASE, '-s', 'read-only', '-'], READ_PROMPT],
    ['codex-edit', 'codex', [...CODEX_BASE, '-s', 'workspace-write', '-'], EDIT_PROMPT],
    ['codex-cancelled', 'codex', [...CODEX_BASE, '-s', 'read-only', '-'], LONG_PROMPT, 8000],
    [
      'codex-invalid-model',
      'codex',
      [...CODEX_BASE, '-s', 'read-only', '-m', 'model-that-does-not-exist', '-'],
      'Chào',
    ],
  ],
};

const DROPPED_KEYS = new Set([
  'accountId',
  'session_id',
  'installationId',
  'environmentId',
  'serverName',
  'userAgent',
  'uuid',
  'memory_paths',
  'original_cwd',
  'messaging_socket_path',
  'credential_expires_at',
  'powershell_path',
  'slash_commands',
  'terminal_slash_commands',
  'skills',
  'plugins',
  'agents',
  'mcp_servers',
  'apiKeySource',
  'analytics_disabled',
  'product_feedback_disabled',
  'modelUsage',
  'iterations',
  'inference_geo',
  'service_tier',
  'model_usage_since_last_result',
  'capabilities',
]);

// agy's init event lists every tool with its full schema: large and not needed by the translator.
function dropAgyInitTools(event) {
  const { tools: _tools, ...init } = event.init ?? {};
  return { ...event, init };
}

// agy streams response text in arbitrary slices, so a path can be cut in two and escape the
// scrubber. Merge the consecutive ACTIVE slices of one step into a single event before scrubbing.
function mergeAgyTextDeltas(events) {
  const merged = [];
  for (const event of events) {
    const update = event.step_update;
    const previous = merged.at(-1)?.step_update;
    if (
      update?.step_type === 'agent_response' &&
      update.state === 'ACTIVE' &&
      typeof update.text_delta === 'string' &&
      previous?.step_type === 'agent_response' &&
      previous.state === 'ACTIVE' &&
      previous.step_index === update.step_index &&
      typeof previous.text_delta === 'string'
    ) {
      previous.text_delta += update.text_delta;
    } else {
      merged.push(event);
    }
  }
  return merged;
}

function sanitiseRecording(rawOutput, workspace) {
  const idReplacements = new Map();
  const replaceId = (value) => {
    if (!idReplacements.has(value)) {
      idReplacements.set(
        value,
        `00000000-0000-4000-8000-${String(idReplacements.size + 1).padStart(12, '0')}`,
      );
    }
    return idReplacements.get(value);
  };
  const scrubText = (text) =>
    text
      .split(workspace)
      .join('/workspace')
      .split(workspace.replaceAll('\\', '\\\\'))
      .join('/workspace')
      .split(workspace.replaceAll('\\', '/'))
      .join('/workspace')
      .split(homedir())
      .join('~')
      .split(homedir().replaceAll('\\', '\\\\'))
      .join('~')
      .split(homedir().replaceAll('\\', '/'))
      .join('~')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replaceId);
  const scrubValue = (value) => {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map(scrubValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !DROPPED_KEYS.has(key))
          .map(([key, inner]) => [key, scrubValue(inner)]),
      );
    }
    return value;
  };
  return (
    mergeAgyTextDeltas(
      rawOutput
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line)),
    )
      .filter((event) => !(event.type === 'system' && /^hook_/.test(event.subtype ?? '')))
      .map((event) =>
        event.type === 'rate_limit_event'
          ? { type: 'rate_limit_event', rate_limit_info: { status: event.rate_limit_info?.status } }
          : event,
      )
      .map((event) => (event.event === 'init' ? dropAgyInitTools(event) : event))
      .map((event) => JSON.stringify(scrubValue(event)))
      .join('\n') + '\n'
  );
}

function recordOne([
  fixtureName,
  command,
  args,
  prompt,
  cancelAfterMs,
  buildStdin = (text) => text,
]) {
  return new Promise((resolve) => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'aiteam-record-'));
    writeFileSync(
      path.join(workspace, 'README.md'),
      '# Dự án mẫu\n\nỨng dụng ghi chú nhỏ viết bằng TypeScript. Có hai lệnh: thêm ghi chú và liệt kê ghi chú.\n',
    );
    const child = spawn(command, args, { cwd: workspace, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.resume();
    child.stdin.end(buildStdin(prompt));
    const timer =
      cancelAfterMs === undefined
        ? undefined
        : setTimeout(() => {
            if (process.platform === 'win32')
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
            else child.kill('SIGTERM');
          }, cancelAfterMs);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      writeFileSync(
        path.join(fixtureDirectory, `${fixtureName}.jsonl`),
        sanitiseRecording(stdout, workspace),
      );
      try {
        // A just-killed agy can still hold the folder for a moment on Windows.
        rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch (error) {
        console.warn(`${fixtureName}: could not remove ${workspace}: ${error.message}`);
      }
      console.log(`${fixtureName}: exit ${exitCode}`);
      resolve();
    });
  });
}

// Quota recordings: the same three commands as the quota readers (spec section 3).
const QUOTA_CLAUDE_ARGS = [
  '-p',
  '/usage',
  '--output-format',
  'json',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true}',
  '--strict-mcp-config',
];
const QUOTA_CODEX_REQUESTS = [
  { id: 1, method: 'initialize', params: { clientInfo: { name: 'aiteam', version: '1' } } },
  { method: 'initialized' },
  { id: 2, method: 'account/rateLimits/read' },
];
const QUOTA_DROPPED_KEYS = new Set([...DROPPED_KEYS, 'conversation_id']);
const CODEX_HOME_PLACEHOLDER = 'C:\\Users\\example\\.codex';

function sanitiseQuotaValue(value, parentKey) {
  if (typeof value === 'string') {
    if (parentKey === 'codexHome') return CODEX_HOME_PLACEHOLDER;
    return value
      .split(homedir())
      .join('~')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
  }
  if (Array.isArray(value)) return value.map((item) => sanitiseQuotaValue(item, parentKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !QUOTA_DROPPED_KEYS.has(key) && !(parentKey === 'credits' && key === 'id'),
        )
        .map(([key, inner]) => [key, sanitiseQuotaValue(inner, key)]),
    );
  }
  return value;
}

function writeQuotaFixture(fixtureName, text) {
  const cleaned = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const entry = sanitiseQuotaValue(JSON.parse(line));
      // The Claude /usage text lists personal tips and skill names after the limits: keep the limits only.
      if (typeof entry.result === 'string' && entry.local_command === 'usage') {
        entry.result = entry.result.split("\n\nWhat's contributing")[0];
      }
      return JSON.stringify(entry);
    });
  writeFileSync(path.join(quotaFixtureDirectory, fixtureName), `${cleaned.join('\n')}\n`);
}

function killProcessTree(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

function readOneShot(command, args, workspace) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: workspace, windowsHide: true, shell: false });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.resume();
    child.stdin.end();
    const timer = setTimeout(() => killProcessTree(child), 30000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout);
    });
  });
}

// codex app-server must keep stdin open until the answer to request id 2 arrives.
function readCodexRateLimits(workspace) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], {
      cwd: workspace,
      windowsHide: true,
      shell: false,
    });
    let buffer = '';
    const lines = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      killProcessTree(child);
      resolve(lines.join('\n'));
    };
    const timer = setTimeout(finish, 30000);
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim() === '') continue;
        lines.push(line);
        try {
          if (JSON.parse(line).id === 2) finish();
        } catch {
          // A non-JSON line is not the answer being waited for.
        }
      }
    });
    child.on('close', finish);
    child.stdin.write(
      QUOTA_CODEX_REQUESTS.map((request) => JSON.stringify(request)).join('\n') + '\n',
    );
  });
}

async function recordQuota(onlyName) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'aiteam-quota-record-'));
  try {
    const jobs = [
      ['claude-usage.json', () => readOneShot('claude', QUOTA_CLAUDE_ARGS, workspace)],
      ['codex-rate-limits.jsonl', () => readCodexRateLimits(workspace)],
      [
        'antigravity-usage.json',
        () => readOneShot('agy', ['-p', '/usage', '--output-format', 'json'], workspace),
      ],
    ];
    for (const [fixtureName, readOutput] of jobs) {
      if (onlyName !== undefined && fixtureName !== onlyName) continue;
      writeQuotaFixture(fixtureName, await readOutput());
      console.log(`${fixtureName}: recorded`);
    }
  } finally {
    try {
      rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      console.warn(`could not remove ${workspace}: ${error.message}`);
    }
  }
}

const selection = process.argv[2] ?? 'all';
const onlyFixture = process.argv[3];
if (selection === 'quota') {
  await recordQuota(onlyFixture);
  process.exit(0);
}
for (const engineName of selection === 'all' ? Object.keys(RECORDINGS) : [selection]) {
  for (const recording of RECORDINGS[engineName]) {
    if (onlyFixture === undefined || recording[0] === onlyFixture) await recordOne(recording);
  }
}
