#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer, { type ConsoleMessage, type Page } from 'puppeteer';

interface RunOptions {
  outputDir: string;
  skipBuild: boolean;
  timeoutMs: number;
}

interface ProjectResponse {
  id: string;
  name: string;
}

interface ScenarioResult {
  name: string;
  projectId: string;
  previewImagePostCount: number;
  screenshotPath: string;
}

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
  'puppeteer-lok-init-test',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

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
      continue;
    }
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      const rawValue = argv[index + 1];
      if (!rawValue || rawValue.startsWith('--')) throw new Error('请为 --timeout-ms 提供大于 0 的数字');
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) throw new Error('请为 --timeout-ms 提供有效的正整数');
      timeoutMs = value;
      index += 1;
      continue;
    }
    throw new Error(`不支持的参数：${arg}`);
  }

  return { outputDir, skipBuild, timeoutMs };
}

function getBunCommand(): string {
  const execName = path.basename(process.execPath).toLowerCase();
  return execName.includes('bun') ? process.execPath : 'bun';
}

function resolveBrowserExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.LAST_VERSION_PPT_CHROME_PATH || process.env.LAST_VERSION_PPT_EDGE_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = process.platform === 'win32'
    ? [
        process.env['PROGRAMFILES'] && path.join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES'] && path.join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : [
        Bun.which('google-chrome'),
        Bun.which('google-chrome-stable'),
        Bun.which('chromium'),
        Bun.which('chromium-browser'),
        Bun.which('microsoft-edge'),
        Bun.which('microsoft-edge-stable'),
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
      ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && existsSync(candidate)) return candidate;
  }
  return undefined;
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

async function waitForHealth(timeoutMs: number, sessionLog: (message: string) => void) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${serverOrigin}/api/health`);
      if (response.ok) {
        sessionLog('后端已经就绪。');
        return;
      }
    } catch {
      // Ignore while waiting for the server to boot.
    }
    await Bun.sleep(1_000);
  }
  throw new Error('等待后端启动超时');
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`请求失败（${response.status}）：${text || response.statusText}`);
  }
  return await response.json() as T;
}

function buildSampleProjectScript() {
  return `module.exports = async function buildPresentation({ pptx, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'puppeteer lok init test';
  pptx.subject = 'LibreOffice 初始化稳定性验证';
  pptx.title = 'LibreOffice 初始化稳定性验证';
  const page = { left: 0.72, width: 11.56, titleTop: 0.52 };
  const baseTextStyle = { fontFace: 'Noto Sans CJK SC', margin: 0 };

  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  cover.addText('LibreOffice 初始化稳定性验证', {
    ...baseTextStyle,
    x: page.left,
    y: 0.76,
    w: page.width,
    h: 1.1,
    fontSize: 32,
    bold: true,
    color: 'FFFFFF'
  });
  cover.addText('无论是主页跳转还是直接打开项目，都应该稳定看到预览图。', {
    ...baseTextStyle,
    x: page.left,
    y: 2.18,
    w: page.width,
    h: 0.8,
    fontSize: 22,
    color: 'CBD5E1'
  });

  const body = pptx.addSlide();
  body.background = { color: 'FFFFFF' };
  body.addText('检查项', {
    ...baseTextStyle,
    x: page.left,
    y: page.titleTop,
    w: page.width,
    h: 0.8,
    fontSize: 28,
    bold: true,
    color: '0F172A'
  });
  body.addText('• 第一次打开就能生成预览\\n• 刷新页面后还能继续生成预览\\n• 不会重复创建两次预览图', {
    ...baseTextStyle,
    x: page.left,
    y: 1.5,
    w: 10.8,
    h: 2.2,
    fontSize: 20,
    color: '334155'
  });

  log('开始验证 LibreOffice 初始化。');
  log('如果能连续两次生成预览图，就说明页面刷新没有卡住。');
};`;
}

function formatConsoleMessage(message: ConsoleMessage, values: unknown[]) {
  const location = message.location();
  const suffix = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : '';
  const detail = values.length > 0 ? ` ${values.map(value => stringifyValue(value)).join(' ')}` : '';
  return `[${new Date().toISOString()}] [${message.type()}] ${message.text()}${detail}${suffix}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readConsoleValues(message: ConsoleMessage) {
  const values: unknown[] = [];
  for (const handle of message.args()) {
    try {
      values.push(await handle.jsonValue());
    } catch {
      values.push('[无法读取的控制台参数]');
    }
  }
  return values;
}

function attachPageLogging(page: Page, outputDir: string, prefix: string) {
  const browserConsoleLog = createTextFileLogger(path.join(outputDir, `${prefix}-browser-console.log`));
  const browserErrorLog = createTextFileLogger(path.join(outputDir, `${prefix}-browser-errors.log`));
  const networkLog = createTextFileLogger(path.join(outputDir, `${prefix}-network.log`));
  let previewImagePostCount = 0;

  page.on('console', async message => {
    const values = await readConsoleValues(message);
    browserConsoleLog(formatConsoleMessage(message, values));
  });
  page.on('pageerror', error => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    browserErrorLog(`[${new Date().toISOString()}] [pageerror] ${message}`);
  });
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/preview-images')) {
      previewImagePostCount += 1;
    }
    networkLog(`[${new Date().toISOString()}] [request] ${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    networkLog(`[${new Date().toISOString()}] [response] ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    networkLog(`[${new Date().toISOString()}] [failed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });

  return () => previewImagePostCount;
}

function startBackend(outputDir: string) {
  const stdoutLog = createTextFileLogger(path.join(outputDir, 'backend-stdout.log'));
  const stderrLog = createTextFileLogger(path.join(outputDir, 'backend-stderr.log'));
  const child = spawn(getBunCommand(), ['run', 'src/index.ts'], {
    cwd: backendDir,
    env: { ...process.env, NO_OPEN_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as unknown as ChildProcessWithoutNullStreams;

  child.stdout.on('data', chunk => stdoutLog(chunk.toString()));
  child.stderr.on('data', chunk => stderrLog(chunk.toString()));

  return child;
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null, sessionLog: (message: string) => void) {
  if (!child || child.killed) return;
  sessionLog('正在停止后端进程…');
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, PROCESS_KILL_TIMEOUT_MS);
    child.once('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function createProject(sessionLog: (message: string) => void, namePrefix: string) {
  const projectName = `${namePrefix}-${Date.now()}`;
  sessionLog(`正在创建测试项目：${projectName}`);
  const project = await readJson<ProjectResponse>(await fetch(`${serverOrigin}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName }),
  }));

  const content = buildSampleProjectScript();
  await readJson<{ success: boolean }>(await fetch(`${serverOrigin}/api/projects/${encodeURIComponent(project.id)}/files/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'index.js', content }),
  }));

  return project;
}

async function waitForProjectPreview(page: Page, timeoutMs: number) {
  await page.waitForFunction(
    () => {
      const bodyText = document.body.textContent || '';
      if (bodyText.includes('出错啦')) return 'error';
      const image = document.querySelector('img[alt="第 1 页预览图"]') as HTMLImageElement | null;
      return image?.src ? 'ready' : false;
    },
    { timeout: timeoutMs },
  );

  const snapshot = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.textContent || '',
    imageCount: document.querySelectorAll('img[alt$="页预览图"]').length,
    url: window.location.href,
  }));

  if (snapshot.bodyText.includes('出错啦')) {
    throw new Error(`项目页显示错误：${snapshot.bodyText}`);
  }

  if (snapshot.imageCount < 1) {
    throw new Error('项目页没有生成任何预览图');
  }

  return snapshot;
}

async function launchBrowser(sessionLog: (message: string) => void) {
  const browserExecutablePath = resolveBrowserExecutablePath();
  if (browserExecutablePath) {
    sessionLog(`将使用本机浏览器：${browserExecutablePath}`);
  } else {
    sessionLog('没有找到本机浏览器路径，将尝试使用 Puppeteer 自带的浏览器。');
  }

  const browserArgs: string[] = [];
  if (process.platform === 'linux' && process.env.PUPPETEER_DISABLE_SANDBOX !== '0') {
    browserArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
    executablePath: browserExecutablePath,
    protocolTimeout: 420_000,
    args: browserArgs,
  });
}

async function runDirectOpenScenario(outputDir: string, timeoutMs: number, sessionLog: (message: string) => void): Promise<ScenarioResult> {
  const project = await createProject(sessionLog, '直接打开项目');
  const browser = await launchBrowser(sessionLog);
  try {
    const page = await browser.newPage();
    const getPreviewImagePostCount = attachPageLogging(page, outputDir, 'direct-open');

    const directUrl = `${serverOrigin}/projects/${encodeURIComponent(project.id)}`;
    sessionLog(`开始场景 1：直接打开项目 ${directUrl}`);
    await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await waitForProjectPreview(page, timeoutMs);

    sessionLog('开始场景 1 刷新验证。');
    await page.reload({ waitUntil: 'networkidle2', timeout: timeoutMs });
    await waitForProjectPreview(page, timeoutMs);

    const previewImagePostCount = getPreviewImagePostCount();
    if (previewImagePostCount !== 2) {
      throw new Error(`直接打开项目场景的预览保存请求次数异常，期望 2 次，实际 ${previewImagePostCount} 次`);
    }

    const screenshotPath = path.join(outputDir, 'direct-open-project.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { name: 'direct-open', projectId: project.id, previewImagePostCount, screenshotPath };
  } finally {
    await browser.close().catch(() => null);
  }
}

async function runHomeNavigationScenario(outputDir: string, timeoutMs: number, sessionLog: (message: string) => void): Promise<ScenarioResult> {
  const project = await createProject(sessionLog, '主页进入项目');
  const browser = await launchBrowser(sessionLog);
  try {
    const page = await browser.newPage();
    const getPreviewImagePostCount = attachPageLogging(page, outputDir, 'home-navigation');

    const homeUrl = `${serverOrigin}/`;
    sessionLog(`开始场景 2：先打开主页 ${homeUrl}`);
    await page.goto(homeUrl, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await page.waitForSelector(`a[href="/projects/${project.id}"]`, { timeout: timeoutMs });
    await page.click(`a[href="/projects/${project.id}"]`);
    await page.waitForFunction(
      targetProjectId => window.location.pathname === `/projects/${targetProjectId}`,
      { timeout: timeoutMs },
      project.id,
    );
    await waitForProjectPreview(page, timeoutMs);

    sessionLog('开始场景 2 刷新验证。');
    await page.reload({ waitUntil: 'networkidle2', timeout: timeoutMs });
    await waitForProjectPreview(page, timeoutMs);

    const previewImagePostCount = getPreviewImagePostCount();
    if (previewImagePostCount !== 2) {
      throw new Error(`主页进入项目场景的预览保存请求次数异常，期望 2 次，实际 ${previewImagePostCount} 次`);
    }

    const screenshotPath = path.join(outputDir, 'home-navigation-project.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { name: 'home-navigation', projectId: project.id, previewImagePostCount, screenshotPath };
  } finally {
    await browser.close().catch(() => null);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = ensureDir(options.outputDir);
  const sessionLogFile = path.join(outputDir, 'session.log');
  const sessionLog = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    appendFileSync(sessionLogFile, `${line}\n`, 'utf8');
  };

  sessionLog(`输出目录：${outputDir}`);

  if (!options.skipBuild || !existsSync(path.join(frontendDistDir, 'index.html'))) {
    const buildLogFile = path.join(outputDir, 'frontend-build.log');
    sessionLog('准备构建前端页面…');
    await runCommand(getBunCommand(), ['run', 'build'], {
      cwd: frontendDir,
      logFile: buildLogFile,
      title: '前端构建',
      env: process.env,
    });
    sessionLog('前端构建完成。');
  } else {
    sessionLog('已跳过前端构建。');
  }

  let backendProcess: ChildProcessWithoutNullStreams | null = null;

  try {
    backendProcess = startBackend(outputDir);
    await waitForHealth(60_000, sessionLog);

    const directOpen = await runDirectOpenScenario(outputDir, options.timeoutMs, sessionLog);
    const homeNavigation = await runHomeNavigationScenario(outputDir, options.timeoutMs, sessionLog);
    const summary = {
      ok: true,
      outputDir,
      scenarios: [directOpen, homeNavigation],
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    sessionLog('LibreOffice 初始化场景测试完成。');
  } finally {
    await stopProcess(backendProcess, sessionLog);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
