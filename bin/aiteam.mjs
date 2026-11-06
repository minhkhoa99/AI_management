#!/usr/bin/env node
// aiteam launcher. Four jobs only: check Node, prepare ~/.aiteam, load the bundled server
// (which applies migrations and listens on 127.0.0.1), open the browser.
// Sub-command: `aiteam doctor` checks the local toolchain.
import { evaluateNodeVersion } from './node-version-policy.mjs';

const nodeVerdict = evaluateNodeVersion(process.version);
if (!nodeVerdict.accepted && process.argv[2] !== 'doctor') {
  console.error(`aiteam: ${nodeVerdict.reason}`);
  console.error('Tải bản vá tại https://nodejs.org/en/download');
  process.exit(1);
}

// node:sqlite prints an ExperimentalWarning on every start. Hide exactly that one; every other
// process warning is still printed.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  const isSqliteExperimentalWarning =
    warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message);
  if (!isSqliteExperimentalWarning) {
    console.warn(`${warning.name}: ${warning.message}`);
  }
});

const { spawn, spawnSync } = await import('node:child_process');
const { randomBytes } = await import('node:crypto');
const { existsSync, mkdirSync, readFileSync } = await import('node:fs');
const { createRequire } = await import('node:module');
const { homedir } = await import('node:os');
const path = (await import('node:path')).default;
const { fileURLToPath } = await import('node:url');
const { parseArgs } = await import('node:util');

const SESSION_TOKEN_BYTES = 32;
const DOCTOR_COMMAND_TIMEOUT_MS = 15_000;

const binDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(binDirectory, '..');
const serverBundlePath = path.join(packageRoot, 'dist', 'server', 'aiteam-server.cjs');
const webRootDirectory = path.join(packageRoot, 'dist', 'web');

function readPackageVersion() {
  const packageManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  return packageManifest.version;
}

function printUsage() {
  console.log(`Cách dùng:
  aiteam [--port <số>] [--no-open]   Khởi động AI Team và mở trình duyệt
  aiteam doctor                      Kiểm tra Node, git, Claude Code, Codex

Cổng: --port, nếu không có thì AITEAM_PORT, nếu không có thì 7419.
Cổng đang bận thì tự thử cổng trống kế tiếp; URL in ra là cổng thật.

Biến môi trường:
  AITEAM_HOME   Thư mục dữ liệu (mặc định ~/.aiteam)
  AITEAM_PORT   Cổng ưu tiên`);
}

function parseLauncherArguments(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return {
    subcommand: positionals[0],
    portOverride: values.port,
    shouldOpenBrowser: !values['no-open'],
    shouldPrintHelp: values.help,
  };
}

/** --port wins over AITEAM_PORT, which wins over the default port. */
function resolvePreferredPort(portOverride, defaultPort) {
  const [sourceLabel, rawPort] =
    portOverride !== undefined
      ? ['--port', portOverride]
      : process.env.AITEAM_PORT !== undefined && process.env.AITEAM_PORT !== ''
        ? ['AITEAM_PORT', process.env.AITEAM_PORT]
        : ['mặc định', String(defaultPort)];
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65_535) {
    throw new Error(`${sourceLabel} phải là số nguyên 1-65535, nhận được "${rawPort}".`);
  }
  return port;
}

function resolveAiteamHome() {
  return process.env.AITEAM_HOME ?? path.join(homedir(), '.aiteam');
}

function prepareDataDirectories(aiteamHome) {
  const directories = {
    dataDirectory: path.join(aiteamHome, 'data'),
    logDirectory: path.join(aiteamHome, 'logs'),
  };
  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return directories;
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const browserProcess = spawn(command, args, { detached: true, stdio: 'ignore' });
  browserProcess.on('error', (error) => {
    console.warn(`Không mở được trình duyệt (${error.message}). Hãy tự mở URL ở trên.`);
  });
  browserProcess.unref();
}

async function startApplication(options) {
  if (!existsSync(serverBundlePath)) {
    throw new Error(`Không tìm thấy ${serverBundlePath}. Chạy "npm run build" trước.`);
  }
  const aiteamHome = resolveAiteamHome();
  const { dataDirectory, logDirectory } = prepareDataDirectories(aiteamHome);
  const version = readPackageVersion();
  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');

  const { startAiteamServer, DEFAULT_SERVER_PORT, SESSION_QUERY_PARAM } = createRequire(
    import.meta.url,
  )(serverBundlePath);
  const preferredPort = resolvePreferredPort(options.portOverride, DEFAULT_SERVER_PORT);
  const runningServer = await startAiteamServer({
    preferredPort,
    version,
    sessionToken,
    dataDirectory,
    logDirectory,
    webRootDirectory,
  });

  // Opened once: the server swaps the token for an HttpOnly cookie and redirects to /.
  const openUrl = `${runningServer.baseUrl}/?${SESSION_QUERY_PARAM}=${sessionToken}`;
  const portNotice =
    runningServer.listenPort === preferredPort
      ? ''
      : `
  Cổng ${preferredPort} đang bận, dùng cổng ${runningServer.listenPort}.`;
  const readyAfterMs = Math.round(performance.now());
  console.log(`AI Team v${version} đang chạy
  Mở:       ${openUrl}
  Dữ liệu:  ${aiteamHome}
  Log:      ${path.join(logDirectory, 'aiteam.log')}
  Sẵn sàng sau ${readyAfterMs} ms. Nhấn Ctrl+C để dừng.${portNotice}`);

  if (options.shouldOpenBrowser) {
    openBrowser(openUrl);
  }

  let isStopping = false;
  const stopOnSignal = (signal) => {
    if (isStopping) {
      console.error('Buộc dừng.');
      process.exit(1);
    }
    isStopping = true;
    console.log(`\nNhận ${signal}, đang dừng...`);
    runningServer.stopServer().then(
      () => process.exit(0),
      (error) => {
        console.error('Lỗi khi dừng server:', error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', stopOnSignal);
  process.on('SIGTERM', stopOnSignal);
}

/** Runs a fixed, trusted command line (no user input) and returns its first output line. */
function probeCommand(commandLine) {
  // shell is required on Windows to resolve .cmd shims (npm-installed CLIs); the command line is
  // a constant from this file, never user input.
  const result = spawnSync(commandLine, {
    shell: true,
    encoding: 'utf8',
    timeout: DOCTOR_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  if (result.error !== undefined) {
    return { passed: false, detail: result.error.message };
  }
  return { passed: result.status === 0, detail: firstLine || `exit code ${result.status}` };
}

function runDoctorChecks() {
  const checks = [
    { label: 'node', outcome: { passed: nodeVerdict.accepted, detail: nodeVerdict.reason } },
    { label: 'git', outcome: probeCommand('git --version') },
    { label: 'claude --version', outcome: probeCommand('claude --version') },
    { label: 'codex --version', outcome: probeCommand('codex --version') },
    { label: 'codex login status', outcome: probeCommand('codex login status') },
  ];

  console.log('aiteam doctor');
  for (const { label, outcome } of checks) {
    console.log(`  ${outcome.passed ? '[ok]  ' : '[lỗi]'} ${label.padEnd(20)} ${outcome.detail}`);
  }
  const failedCount = checks.filter((check) => !check.outcome.passed).length;
  console.log(failedCount === 0 ? 'Mọi kiểm tra đều đạt.' : `${failedCount} kiểm tra chưa đạt.`);
  return failedCount === 0 ? 0 : 1;
}

try {
  const options = parseLauncherArguments(process.argv.slice(2));
  if (options.shouldPrintHelp) {
    printUsage();
  } else if (options.subcommand === 'doctor') {
    process.exitCode = runDoctorChecks();
  } else if (options.subcommand === undefined) {
    await startApplication(options);
  } else {
    printUsage();
    process.exitCode = 1;
  }
} catch (error) {
  const code = error?.code === undefined ? '' : ` [${error.code}]`;
  console.error(`aiteam: ${error?.message ?? error}${code}`);
  process.exitCode = 1;
}
