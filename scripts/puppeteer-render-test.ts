#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer, { type ConsoleMessage, type Page } from 'puppeteer';
import {
  PPT_POINT_TO_PIXEL_RATIO,
  PPT_TEXT_SAFE_WIDTH_RATIO,
  calculateSafeTextBoxHeight,
} from '../backend/src/ppt-text-layout.ts';

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
const COVER_TITLE_HEIGHT = calculateSafeTextBoxHeight(88);
const PAGE_TITLE_HEIGHT = calculateSafeTextBoxHeight(72);
const SECTION_TITLE_HEIGHT = calculateSafeTextBoxHeight(56);
const BODY_TEXT_HEIGHT = calculateSafeTextBoxHeight(48);
const THREE_LINE_BODY_HEIGHT = calculateSafeTextBoxHeight(48, 3);
const canvasFontFamily = '_LastVersionPptCanvasSubset';
const canvasFontPath = '/fonts/last-version-ppt-cjk-subset.otf';
const canvasTextChecks = [
  { label: '默认目录说明 1', text: '讲清主题重点。', width: 6.98, fontSize: 48 },
  { label: '默认目录说明 2', text: '列出章节顺序。', width: 6.98, fontSize: 48 },
  { label: '默认目录说明 3', text: '展开重点动作。', width: 6.98, fontSize: 48 },
  { label: '默认正文右侧 1', text: '先放关键结果。', width: 5.2, fontSize: 48 },
  { label: '默认正文右侧 2', text: '写清时间安排。', width: 5.16, fontSize: 48 },
  { label: '渲染目录说明 1', text: '说明这份演示稿要讲什么。', width: 6.98, fontSize: 48 },
  { label: '渲染目录说明 2', text: '把章节顺序列清楚。', width: 6.98, fontSize: 48 },
  { label: '渲染目录说明 3', text: '用正文页检查字号排版。', width: 6.98, fontSize: 48 },
  { label: '渲染正文右侧', text: '截图后可检查排版。', width: 5.2, fontSize: 48 },
] as const;

function parseArgs(argv: string[]): RunOptions {
  let outputDir = defaultOutputDir;
  let skipBuild = false;
  // 首次冷启动 LibreOffice WASM + 字体上传会明显更慢，多页示例需要预留更充足的等待时间。
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
  const page = { left: 0.72, width: 11.56, titleTop: 0.52 };
  const baseTextStyle = { fontFace: 'Noto Sans CJK SC', margin: 0 };

  const cover = pptx.addSlide();
  cover.background = { color: '0F172A' };
  cover.addText('中文预览验证成功', {
    ...baseTextStyle,
    x: page.left,
    y: 0.76,
    w: page.width,
    h: ${COVER_TITLE_HEIGHT},
    fontSize: 88,
    bold: true,
    color: 'FFFFFF'
  });
  cover.addText('封面、目录、正文三页都能正常出图。', {
    ...baseTextStyle,
    x: page.left,
    y: 2.18,
    w: page.width,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    color: 'CBD5E1'
  });
  cover.addText('截图会保存到临时目录，方便检查排版。', {
    ...baseTextStyle,
    x: page.left,
    y: 3.42,
    w: page.width,
    h: ${BODY_TEXT_HEIGHT},
    fontSize: 48,
    color: 'E2E8F0'
  });

  const agenda = pptx.addSlide();
  agenda.background = { color: 'F8FAFC' };
  agenda.addText('目录', {
    ...baseTextStyle,
    x: page.left,
    y: page.titleTop,
    w: page.width,
    h: ${PAGE_TITLE_HEIGHT},
    fontSize: 72,
    bold: true,
    color: '0F172A'
  });
  [
    { no: '01', title: '封面', desc: '说明这份演示稿要讲什么。' },
    { no: '02', title: '目录', desc: '把章节顺序列清楚。' },
    { no: '03', title: '正文', desc: '用正文页检查字号排版。' }
  ].forEach((item, index) => {
    const y = 1.42 + index * 1.62;
    agenda.addText(item.no, {
      ...baseTextStyle,
      x: page.left,
      y,
      w: 0.9,
      h: ${SECTION_TITLE_HEIGHT},
      fontSize: 56,
      bold: true,
      color: '2563EB'
    });
    agenda.addText(item.title, {
      ...baseTextStyle,
      x: 1.9,
      y: y + 0.04,
      w: 2.6,
      h: ${BODY_TEXT_HEIGHT},
      fontSize: 48,
      bold: true,
      color: '0F172A'
    });
    agenda.addText(item.desc, {
      ...baseTextStyle,
      x: 4.94,
      y: y + 0.04,
      w: 6.98,
      h: ${BODY_TEXT_HEIGHT},
      fontSize: 48,
      color: '475569'
    });
  });

  const body = pptx.addSlide();
  body.background = { color: 'FFFFFF' };
  body.addText('正文页排版检查', {
    ...baseTextStyle,
    x: page.left,
    y: page.titleTop,
    w: page.width,
    h: ${PAGE_TITLE_HEIGHT},
    fontSize: 72,
    bold: true,
    color: '0F172A'
  });
  body.addText('检查项', {
    ...baseTextStyle,
    x: page.left,
    y: 1.56,
    w: 3.0,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  body.addText('• 标题不要重叠\\n• 正文不要过早换行\\n• 中文不要变成方块', {
    ...baseTextStyle,
    x: page.left,
    y: 2.52,
    w: 5.24,
    h: ${THREE_LINE_BODY_HEIGHT},
    fontSize: 48,
    color: '334155'
  });
  body.addText('检查结果', {
    ...baseTextStyle,
    x: 6.32,
    y: 1.56,
    w: 2.7,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '1D4ED8'
  });
  body.addText('截图后可检查排版。', {
    ...baseTextStyle,
    x: 6.32,
    y: 2.52,
    w: 5.2,
    h: ${BODY_TEXT_HEIGHT},
    fontSize: 48,
    color: '1E3A8A'
  });
  body.addText('生成时间', {
    ...baseTextStyle,
    x: 6.32,
    y: 4.14,
    w: 2.7,
    h: ${SECTION_TITLE_HEIGHT},
    fontSize: 56,
    bold: true,
    color: '0F172A'
  });
  body.addText(new Date().toLocaleString('zh-CN', { hour12: false }), {
    ...baseTextStyle,
    x: 6.32,
    y: 5.1,
    w: 5.16,
    h: ${BODY_TEXT_HEIGHT},
    fontSize: 48,
    color: '475569'
  });

  log('开始生成中文预览图');
  log('页面里应该能看到封面、目录、正文共 3 页。');
  log({ slideCount: 3, note: '如果三张图片都生成成功，说明当前默认尺寸能承载 88/72/56/48 这组字号。' });
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
    const message = error instanceof Error ? error.stack || error.message : String(error);
    browserErrorLog(`[${new Date().toISOString()}] [pageerror] ${message}`);
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

async function saveCanvasMetrics(page: Page, outputDir: string, sessionLog: (message: string) => void) {
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face {
      font-family: '${canvasFontFamily}';
      src: url('${new URL(canvasFontPath, serverOrigin).toString()}') format('opentype');
      font-display: block;
    }
    body { margin: 0; font-family: '${canvasFontFamily}', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif; }
  </style></head><body></body></html>`);
  const results = await page.evaluate(({ checks, safeWidthRatio, fontFamily, pointToPixelRatio }) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 canvas 上下文');
    return Promise.all(checks.map(async item => {
      const fontSizePx = item.fontSize * pointToPixelRatio;
      await document.fonts.load(`${fontSizePx}px "${fontFamily}"`);
      await document.fonts.ready;
      context.font = `${fontSizePx}px "${fontFamily}", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`;
      const widthPx = context.measureText(item.text).width;
      const maxWidthPx = Math.floor(item.width * 96 * safeWidthRatio);
      return {
        ...item,
        widthPx,
        maxWidthPx,
        fitsSingleLine: widthPx <= maxWidthPx,
      };
    }));
  }, { checks: canvasTextChecks, safeWidthRatio: PPT_TEXT_SAFE_WIDTH_RATIO, fontFamily: canvasFontFamily, pointToPixelRatio: PPT_POINT_TO_PIXEL_RATIO });
  writeFileSync(path.join(outputDir, 'canvas-text-metrics.json'), JSON.stringify(results, null, 2), 'utf8');
  const failed = results.filter(item => !item.fitsSingleLine);
  if (failed.length > 0) {
    throw new Error(`以下文案超过单行安全宽度：${failed.map(item => `${item.label}(${item.widthPx}/${item.maxWidthPx})`).join('、')}`);
  }
  sessionLog(`Canvas 校验完成：${results.length} 条单行文案均不超过 ${PPT_TEXT_SAFE_WIDTH_RATIO.toFixed(2)} 安全宽度。`);
}

async function saveImages(outputDir: string, imageUrls: string[], sessionLog: (message: string) => void) {
  const filePaths: string[] = [];

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index];
    const absoluteUrl = new URL(imageUrl, serverOrigin).toString();
    const response = await fetch(absoluteUrl);
    if (!response.ok) throw new Error(`下载第 ${index + 1} 页预览图失败：${response.status}`);
    const filePath = path.join(outputDir, `rendered-slide-${index + 1}.png`);
    writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    filePaths.push(filePath);
    sessionLog(`第 ${index + 1} 页预览图已保存：${filePath}`);
  }

  return filePaths;
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
    await saveCanvasMetrics(page, outputDir, sessionLog);

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

    const imagePaths = await saveImages(outputDir, state.images, sessionLog);
    const summary = {
      ok: true,
      projectId: state.projectId,
      status: state.status,
      slideCount: state.slideCount,
      imageCount: state.images.length,
      outputDir,
      screenshotPath,
      imagePaths,
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
