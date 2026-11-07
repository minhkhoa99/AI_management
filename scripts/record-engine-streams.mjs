#!/usr/bin/env node
// Records real JSONL streams from the local Claude Code and Codex CLIs, sanitises them, and
// writes them as contract-test fixtures. Re-run when a CLI changes its output format.
//
//   node scripts/record-engine-streams.mjs [claude|codex|all] [fixture-name]
//
// Spends a little of the signed-in accounts' quota (a few tiny prompts, cheapest models).
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
      .split(homedir())
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
    rawOutput
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
      .filter((event) => !(event.type === 'system' && /^hook_/.test(event.subtype ?? '')))
      .map((event) =>
        event.type === 'rate_limit_event'
          ? { type: 'rate_limit_event', rate_limit_info: { status: event.rate_limit_info?.status } }
          : event,
      )
      .map((event) => JSON.stringify(scrubValue(event)))
      .join('\n') + '\n'
  );
}

function recordOne([fixtureName, command, args, prompt, cancelAfterMs]) {
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
    child.stdin.end(prompt);
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
      rmSync(workspace, { recursive: true, force: true });
      console.log(`${fixtureName}: exit ${exitCode}`);
      resolve();
    });
  });
}

const selection = process.argv[2] ?? 'all';
const onlyFixture = process.argv[3];
for (const engineName of selection === 'all' ? Object.keys(RECORDINGS) : [selection]) {
  for (const recording of RECORDINGS[engineName]) {
    if (onlyFixture === undefined || recording[0] === onlyFixture) await recordOne(recording);
  }
}
