#!/usr/bin/env bun

/**
 * Puppeteer 测试 — 验证 LibreOffice 环境在各种导航场景下都能正常初始化。
 *
 * 场景 1：直接打开项目页 → 预览正常生成
 * 场景 2：刷新项目页 → 预览正常生成
 * 场景 3：从主页跳转到项目页 → 预览正常生成
 *
 * 用法：
 *   bun run scripts/puppeteer-lok-init-test.ts [--skip-build] [--timeout-ms N]
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer, { type ConsoleMessage, type Page } from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const frontendDistDir = path.join(frontendDir, 'dist');
const backendDir = path.join(repoRoot, 'backend');
const serverOrigin = 'http://127.0.0.1:3101';
const PROCESS_KILL_TIMEOUT_MS = 5_000;
const defaultOutputDir = path.join(
  tmpdir(),
  'last-version-ppt',
  'lok-init-test',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

interface RunOptions {
  outputDir: string;
  skipBuild: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): RunOptions {
  let outputDir = defaultOutputDir;
  let skipBuild = false;
  let timeoutMs = 420_000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('缺少 --output-dir 的目录参数');
      outputDir = path.resolve(value);
      index += 1;
    } else if (arg === '--skip-build') {
      skipBuild = true;
    } else if (arg === '--timeout-ms') {
      const rawValue = argv[index + 1];
      if (!rawValue || rawValue.startsWith('--')) throw new Error('请为 --timeout-ms 提供大于 0 的数字');
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) throw new Error('请为 --timeout-ms 提供有效的正整数');
      timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`不支持的参数：${arg}`);
    }
  }

  return { outputDir, skipBuild, timeoutMs };
}

function getBunCommand(): string {
  const execName = path.basename(process.execPath).toLowerCase();
  return execName.includes('bun') ? process.execPath : 'bun';
}

function resolveBrowserExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.LAST_VERSION_PPT_CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = process.platform === 'win32'
    ? [
        process.env['PROGRAMFILES'] && path.join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : [
        Bun.which('google-chrome'),
        Bun.which('chromium'),
        Bun.which('chromium-browser'),
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

  return candidates.find(c => typeof c === 'string' && existsSync(c));
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTextFileLogger(filePath: string) {
  return (message: string) => {
    appendFileSync(filePath, message.endsWith('\n') ? message : `${message}\n`, 'utf8');
  };
}

async function runCommand(command: string, args: string[], options: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logFile: string;
  title: string;
}) {
  const log = createTextFileLogger(options.logFile);
  log(`[${new Date().toISOString()}] ${options.title}`);
  log(`命令：${command} ${args.join(' ')}`);

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => log(chunk.toString()));
  child.stderr.on('data', chunk => log(chunk.toString()));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${options.title}失败，退出码 ${exitCode}`);
  }
}

async function waitForHealth(timeoutMs: number, sessionLog: (m: string) => void) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${serverOrigin}/api/health`);
      if (res.ok) { sessionLog('后端已经就绪。'); return; }
    } catch { /* waiting */ }
    await Bun.sleep(1_000);
  }
  throw new Error('等待后端启动超时');
}

function startBackend(outputDir: string) {
  const stdoutLog = createTextFileLogger(path.join(outputDir, 'backend-stdout.log'));
  const stderrLog = createTextFileLogger(path.join(outputDir, 'backend-stderr.log'));
  const child = spawn(getBunCommand(), ['run', 'src/index.ts'], {
    cwd: backendDir,
    env: { ...process.env, NO_OPEN_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  child.stdout.on('data', chunk => stdoutLog(chunk.toString()));
  child.stderr.on('data', chunk => stderrLog(chunk.toString()));
  return child;
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null, sessionLog: (m: string) => void) {
  if (!child || child.killed) return;
  sessionLog('正在停止后端进程…');
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, PROCESS_KILL_TIMEOUT_MS);
    child.once('close', () => { clearTimeout(timer); resolve(null); });
  });
}

async function createProject(sessionLog: (m: string) => void) {
  const name = `LOK-初始化检查-${Date.now()}`;
  sessionLog(`正在创建测试项目：${name}`);
  const res = await fetch(`${serverOrigin}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`创建项目失败：${await res.text()}`);
  const project = await res.json() as { id: string; name: string };

  const content = buildSampleScript();
  const putRes = await fetch(`${serverOrigin}/api/projects/${encodeURIComponent(project.id)}/files/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'index.js', content }),
  });
  if (!putRes.ok) throw new Error(`写入脚本失败：${await putRes.text()}`);

  return project;
}

function buildSampleScript() {
  return `module.exports = async function buildPresentation({ pptx, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'LOK init test';
  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  cover.addText('LibreOffice 初始化测试', {
    x: 0.72, y: 1.5, w: 11.56, h: 1.2,
    fontSize: 72, bold: true, color: 'FFFFFF', fontFace: 'Noto Sans CJK SC', margin: 0,
  });
  cover.addText('如果看到这张图就说明初始化成功了', {
    x: 0.72, y: 3.0, w: 11.56, h: 0.9,
    fontSize: 48, color: 'CBD5E1', fontFace: 'Noto Sans CJK SC', margin: 0,
  });
  log('LOK 初始化测试脚本运行完成');
};
`;
}

function attachPageLogging(page: Page, outputDir: string) {
  const consoleLog = createTextFileLogger(path.join(outputDir, 'browser-console.log'));
  const errorLog = createTextFileLogger(path.join(outputDir, 'browser-errors.log'));
  page.on('console', async (msg: ConsoleMessage) => {
    const values: string[] = [];
    for (const h of msg.args()) { try { values.push(JSON.stringify(await h.jsonValue())); } catch { values.push('?'); } }
    consoleLog(`[${new Date().toISOString()}] [${msg.type()}] ${msg.text()} ${values.join(' ')}`);
  });
  page.on('pageerror', err => errorLog(`[${new Date().toISOString()}] ${err.stack || err.message}`));
}

/**
 * 在项目页等待预览图片出现（至少 1 张 <img>），或等待出错提示。
 * 返回 { ok, imageCount, errorText? }
 */
async function waitForProjectPreview(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(() => {
      // 检查有没有预览图片 — 项目页的预览图 src 以 /api/ 开头
      const previewImages = Array.from(document.querySelectorAll('img')).filter(
        img => img.src.includes('/api/') && img.src.includes('preview') && img.naturalWidth > 0,
      );
      if (previewImages.length > 0) {
        return { ok: true as const, imageCount: previewImages.length };
      }
      // 检查是否有错误信息
      const errorEl = document.querySelector('[data-preview-error]');
      if (errorEl?.textContent) {
        return { ok: false as const, imageCount: 0, errorText: errorEl.textContent };
      }
      return null; // 还在加载中
    });
    if (result) return result;
    await new Promise(r => setTimeout(r, 2_000));
  }
  // 超时，截图并返回
  return { ok: false as const, imageCount: 0, errorText: '等待预览图超时' };
}

/**
 * 在 preview-image-test.html 等待结果。
 */
async function waitForTestPageResult(page: Page, timeoutMs: number) {
  await page.waitForFunction(
    () => {
      const state = (window as any).__PREVIEW_IMAGE_TEST_STATE__;
      return state?.phase === 'done' || state?.phase === 'error';
    },
    { timeout: timeoutMs },
  );
  return await page.evaluate(() => (window as any).__PREVIEW_IMAGE_TEST_STATE__ || null) as {
    phase: string; status: string; images: string[]; slideCount: number;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = ensureDir(options.outputDir);
  const sessionLogFile = path.join(outputDir, 'session.log');
  const sessionLog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    appendFileSync(sessionLogFile, `${line}\n`, 'utf8');
  };

  sessionLog(`输出目录：${outputDir}`);

  // ── 构建前端 ────────────────────────
  if (!options.skipBuild || !existsSync(path.join(frontendDistDir, 'index.html'))) {
    sessionLog('准备构建前端页面…');
    await runCommand(getBunCommand(), ['run', 'build'], {
      cwd: frontendDir,
      logFile: path.join(outputDir, 'frontend-build.log'),
      title: '前端构建',
      env: process.env,
    });
    sessionLog('前端构建完成。');
  } else {
    sessionLog('已跳过前端构建。');
  }

  let backendProcess: ChildProcessWithoutNullStreams | null = null;
  const results: Array<{ scenario: string; ok: boolean; detail: string }> = [];

  // ── 浏览器启动辅助函数 ────────────────────────
  const browserExe = resolveBrowserExecutablePath();
  const browserArgs: string[] = [];
  if (process.platform === 'linux' && process.env.PUPPETEER_DISABLE_SANDBOX !== '0') {
    browserArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  async function launchBrowser() {
    if (browserExe) sessionLog(`浏览器路径：${browserExe}`);
    return await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
      executablePath: browserExe,
      args: browserArgs,
      protocolTimeout: options.timeoutMs,
    });
  }

  try {
    backendProcess = startBackend(outputDir);
    await waitForHealth(60_000, sessionLog);

    const project = await createProject(sessionLog);
    sessionLog(`测试项目 ID：${project.id}`);
    const testUrl = `${serverOrigin}/preview-image-test.html?projectId=${encodeURIComponent(project.id)}`;

    // ────────────────────────────────────────────────────────────
    // 场景 1：直接打开 preview-image-test 页（等同于直接访问项目）
    // ────────────────────────────────────────────────────────────
    {
      const scenarioDir = ensureDir(path.join(outputDir, 'scenario-1-direct'));
      sessionLog('======== 场景 1：直接打开测试页 ========');
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        attachPageLogging(page, scenarioDir);
        sessionLog(`打开：${testUrl}`);
        await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });
        const state = await waitForTestPageResult(page, options.timeoutMs);
        await page.screenshot({ path: path.join(scenarioDir, 'screenshot.png'), fullPage: true });
        writeFileSync(path.join(scenarioDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
        const ok = state?.phase === 'done' && state.images.length > 0;
        results.push({ scenario: '直接打开测试页', ok, detail: state?.status ?? '无状态' });
        sessionLog(`场景 1 结果：${ok ? '✅ 通过' : '❌ 失败'} — ${state?.status}`);
      } finally {
        await browser.close().catch(() => null);
      }
    }

    // ────────────────────────────────────────────────────────────
    // 场景 2：打开后刷新页面
    // ────────────────────────────────────────────────────────────
    {
      const scenarioDir = ensureDir(path.join(outputDir, 'scenario-2-refresh'));
      sessionLog('======== 场景 2：打开后刷新页面 ========');
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        attachPageLogging(page, scenarioDir);
        sessionLog(`打开：${testUrl}`);
        await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });
        const firstState = await waitForTestPageResult(page, options.timeoutMs);
        sessionLog(`第一次渲染结果：${firstState?.status}`);
        await page.screenshot({ path: path.join(scenarioDir, 'before-refresh.png'), fullPage: true });

        sessionLog('正在刷新页面…');
        await page.reload({ waitUntil: 'networkidle2', timeout: options.timeoutMs });
        const state = await waitForTestPageResult(page, options.timeoutMs);
        await page.screenshot({ path: path.join(scenarioDir, 'after-refresh.png'), fullPage: true });
        writeFileSync(path.join(scenarioDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
        const ok = state?.phase === 'done' && state.images.length > 0;
        results.push({ scenario: '刷新后重新生成', ok, detail: state?.status ?? '无状态' });
        sessionLog(`场景 2 结果：${ok ? '✅ 通过' : '❌ 失败'} — ${state?.status}`);
      } finally {
        await browser.close().catch(() => null);
      }
    }

    // ────────────────────────────────────────────────────────────
    // 场景 3：先打开主页，然后跳转到项目页
    // ────────────────────────────────────────────────────────────
    {
      const scenarioDir = ensureDir(path.join(outputDir, 'scenario-3-home-then-project'));
      sessionLog('======== 场景 3：先打开主页再跳转到项目 ========');
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        attachPageLogging(page, scenarioDir);
        sessionLog('打开主页…');
        await page.goto(serverOrigin, { waitUntil: 'networkidle2', timeout: 30_000 });
        await page.screenshot({ path: path.join(scenarioDir, 'home.png'), fullPage: true });

        sessionLog(`跳转到：${testUrl}`);
        await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });
        const state = await waitForTestPageResult(page, options.timeoutMs);
        await page.screenshot({ path: path.join(scenarioDir, 'project.png'), fullPage: true });
        writeFileSync(path.join(scenarioDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
        const ok = state?.phase === 'done' && state.images.length > 0;
        results.push({ scenario: '主页跳转到项目', ok, detail: state?.status ?? '无状态' });
        sessionLog(`场景 3 结果：${ok ? '✅ 通过' : '❌ 失败'} — ${state?.status}`);
      } finally {
        await browser.close().catch(() => null);
      }
    }

    // ── 汇总 ────────────────────────────
    sessionLog('');
    sessionLog('════════════════════════════════════════');
    const allOk = results.every(r => r.ok);
    for (const r of results) {
      sessionLog(`  ${r.ok ? '✅' : '❌'} ${r.scenario}：${r.detail}`);
    }
    sessionLog(`总计：${results.filter(r => r.ok).length}/${results.length} 通过`);
    sessionLog('════════════════════════════════════════');

    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ allOk, results }, null, 2), 'utf8');

    if (!allOk) {
      throw new Error(`部分场景失败，详见 ${outputDir}`);
    }
    sessionLog('全部场景通过！');
  } finally {
    await stopProcess(backendProcess, sessionLog);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
