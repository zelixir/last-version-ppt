#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer, { type ConsoleMessage, type Page } from 'puppeteer';

interface RenderPageState {
  projectId: string;
  phase: 'idle' | 'running' | 'done' | 'error';
  status: string;
  images: string[];
  previewLogs: string[];
  slideCount: number;
  updatedAt: string;
}

interface RunOptions {
  outputDir: string;
  skipBuild: boolean;
  timeoutMs: number;
}

interface ProjectResponse {
  id: string;
  name: string;
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
  'puppeteer-render-test',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

function parseArgs(argv: string[]): RunOptions {
  let outputDir = defaultOutputDir;
  let skipBuild = false;
  let timeoutMs = 240_000;

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
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.LAST_VERSION_PPT_CHROME_PATH;
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
        Bun.which('chromium'),
        Bun.which('chromium-browser'),
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

  return candidates.find(candidate => typeof candidate === 'string' && existsSync(candidate));
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
  log(`[${
    new Date().toISOString()
  }] ${options.title}`);
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
  pptx.author = 'puppeteer render test';
  pptx.subject = '中文预览验证';
  pptx.title = '中文出图验证';

  const slide = pptx.addSlide();
  const baseTextStyle = { fontFace: 'Noto Sans CJK SC' };
  slide.background = { color: 'F8FAFC' };
  slide.addText('中文预览验证成功', {
    ...baseTextStyle,
    x: 0.8,
    y: 0.72,
    w: 11.2,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: '0F172A'
  });
  slide.addText('这张图片由 Puppeteer 自动触发生成，用来确认汉字能正常显示。', {
    ...baseTextStyle,
    x: 0.8,
    y: 1.7,
    w: 11.4,
    h: 0.7,
    fontSize: 18,
    color: '334155'
  });
  slide.addText('你好，世界！欢迎使用最后一版 PPT。', {
    ...baseTextStyle,
    x: 0.8,
    y: 2.72,
    w: 11.2,
    h: 0.8,
    fontSize: 24,
    color: '1D4ED8',
    bold: true
  });
  slide.addText('日志会同时保存浏览器输出、网络请求、页面状态和后端输出，方便排查问题。', {
    ...baseTextStyle,
    x: 0.8,
    y: 3.86,
    w: 11.4,
    h: 1.1,
    fontSize: 18,
    color: '475569'
  });
  slide.addText('生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }), {
    ...baseTextStyle,
    x: 0.8,
    y: 5.38,
    w: 11,
    h: 0.4,
    fontSize: 12,
    color: '64748B'
  });

  log('开始生成中文预览图');
  log('页面里应该能看到“你好，世界！欢迎使用最后一版 PPT。”这行文字');
  log({ slideCount: 1, note: '如果日志文件里出现这条记录，说明页面脚本日志已经通了。' });
};
`;
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

function attachPageLogging(page: Page, outputDir: string) {
  const browserConsoleLog = createTextFileLogger(path.join(outputDir, 'browser-console.log'));
  const browserErrorLog = createTextFileLogger(path.join(outputDir, 'browser-errors.log'));
  const networkLog = createTextFileLogger(path.join(outputDir, 'network.log'));

  page.on('console', async message => {
    const values = await readConsoleValues(message);
    browserConsoleLog(formatConsoleMessage(message, values));
  });
  page.on('pageerror', error => {
    browserErrorLog(`[${new Date().toISOString()}] [pageerror] ${error.stack || error.message}`);
  });
  page.on('request', request => {
    networkLog(`[${new Date().toISOString()}] [request] ${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    networkLog(`[${new Date().toISOString()}] [response] ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    networkLog(`[${new Date().toISOString()}] [failed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
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

async function createProject(sessionLog: (message: string) => void) {
  const projectName = `中文出图检查-${Date.now()}`;
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

  return { project, content };
}

async function saveProjectMetadata(outputDir: string, projectId: string) {
  const projectFiles = await readJson(await fetch(`${serverOrigin}/api/projects/${encodeURIComponent(projectId)}/files`));
  const systemFonts = await readJson(await fetch(`${serverOrigin}/api/system-fonts`));
  writeFileSync(path.join(outputDir, 'project-files.json'), JSON.stringify(projectFiles, null, 2), 'utf8');
  writeFileSync(path.join(outputDir, 'system-fonts.json'), JSON.stringify(systemFonts, null, 2), 'utf8');
}

async function waitForRenderResult(page: Page, timeoutMs: number) {
  await page.waitForFunction(
    () => {
      const state = window.__PREVIEW_IMAGE_TEST_STATE__;
      return state?.phase === 'done' || state?.phase === 'error';
    },
    { timeout: timeoutMs },
  );
  return await page.evaluate(() => window.__PREVIEW_IMAGE_TEST_STATE__ || null) as RenderPageState | null;
}

async function saveImage(outputDir: string, imageUrl: string, sessionLog: (message: string) => void) {
  const absoluteUrl = new URL(imageUrl, serverOrigin).toString();
  const response = await fetch(absoluteUrl);
  if (!response.ok) throw new Error(`下载预览图失败：${response.status}`);
  const filePath = path.join(outputDir, 'rendered-slide-1.png');
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  sessionLog(`第一页预览图已保存：${filePath}`);
  return filePath;
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
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    backendProcess = startBackend(outputDir);
    await waitForHealth(60_000, sessionLog);

    const { project, content } = await createProject(sessionLog);
    writeFileSync(path.join(outputDir, 'project-index.js'), content, 'utf8');
    await saveProjectMetadata(outputDir, project.id);

    sessionLog('正在启动浏览器…');
    const browserExecutablePath = resolveBrowserExecutablePath();
    if (browserExecutablePath) {
      sessionLog(`将使用本机浏览器：${browserExecutablePath}`);
    } else {
      sessionLog('没有找到本机浏览器路径，将尝试使用 Puppeteer 自带的浏览器。');
    }
    const browserArgs: string[] = [];
    if (process.platform === 'linux' && process.env.PUPPETEER_DISABLE_SANDBOX !== '0') {
      // Sandbox is disabled by default on Linux unless PUPPETEER_DISABLE_SANDBOX=0 is set.
      // Set PUPPETEER_DISABLE_SANDBOX=0 to enable sandboxing when the environment supports it.
      browserArgs.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
      executablePath: browserExecutablePath,
      args: browserArgs,
    });

    const page = await browser.newPage();
    attachPageLogging(page, outputDir);

    const pageUrl = `${serverOrigin}/preview-image-test.html?projectId=${encodeURIComponent(project.id)}`;
    sessionLog(`正在打开页面：${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });

    const state = await waitForRenderResult(page, options.timeoutMs);
    writeFileSync(path.join(outputDir, 'page-state.json'), JSON.stringify(state, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'page.html'), await page.content(), 'utf8');

    const screenshotPath = path.join(outputDir, 'preview-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    sessionLog(`页面截图已保存：${screenshotPath}`);

    if (!state) throw new Error('页面没有返回可用状态');
    if (state.phase === 'error') {
      throw new Error(`页面报错：${state.status}`);
    }
    if (!state.images[0]) {
      throw new Error('页面没有生成任何预览图');
    }

    const imagePath = await saveImage(outputDir, state.images[0], sessionLog);
    const summary = {
      ok: true,
      projectId: state.projectId,
      status: state.status,
      slideCount: state.slideCount,
      imageCount: state.images.length,
      outputDir,
      screenshotPath,
      imagePath,
      pageUrl,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    sessionLog('渲染测试完成。');
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
    await stopProcess(backendProcess, sessionLog);
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
