#!/usr/bin/env node

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import puppeteer, { type ConsoleMessage, type Page } from 'puppeteer'

interface MainRunOptions {
  mode: 'main'
  outputDir: string
  skipBuild: boolean
  timeoutMs: number
  text: string
}

interface NodeRenderRunOptions {
  mode: 'nodejs-render-ppt'
  pptxPath: string
  fontPath: string
  fontFileName: string
  outputFile: string
  renderWidth: number
  logFile: string
}

type RunOptions = MainRunOptions | NodeRenderRunOptions

interface ProjectResponse {
  id: string
  name: string
}

interface FontAsset {
  fileName: string
  family: string
  mimeType: string
  filePath: string
  buffer: Buffer
  dataUrl: string
  size: number
  sourcePath: string
}

interface BoundingBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface CanvasMetrics {
  advanceWidthPx: number
  occupiedWidthPx: number
  actualBoundingBoxLeft: number
  actualBoundingBoxRight: number
  actualBoundingBoxAscent: number
  actualBoundingBoxDescent: number
}

interface RasterAnalysisResult {
  width: number
  height: number
  boundingBox: BoundingBox | null
  imageDataUrl: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const backendDir = path.join(repoRoot, 'backend')
const bundledFontPath = path.join(repoRoot, 'scripts', 'assets', 'NotoSansCJKsc-Regular.otf')
const serverOrigin = 'http://127.0.0.1:3101'
const PROCESS_KILL_TIMEOUT_MS = 5_000
const PPT_POINT_TO_PIXEL_RATIO = 96 / 72
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720
const TEXT_LEFT_PX = 96
const TEXT_BASELINE_PX = 280
const FONT_SIZE_PT = 48
const FONT_SIZE_PX = FONT_SIZE_PT * PPT_POINT_TO_PIXEL_RATIO
const PPT_IMAGE_WIDTH = 1600
const PPT_IMAGE_HEIGHT = Math.round(PPT_IMAGE_WIDTH * 9 / 16)
const FONT_FILE_NAME = 'NotoSansCJKsc-Regular.otf'
const FONT_FAMILY = 'Noto Sans CJK SC'
const FONT_MIME_TYPE = 'font/otf'
const DEFAULT_TEST_TEXT = '说明这份演示稿要讲什么。'
const CV_THRESHOLD = 245
const MAX_ALLOWED_CV_DIFF_PX = 12
const defaultOutputDir = path.join(
  repoRoot,
  'out',
  'ppt-text-canvas-cv',
  new Date().toISOString().replace(/[:.]/g, '-'),
)

function parseArgs(argv: string[]): RunOptions {
  if (argv.includes('--nodejs-render-ppt')) {
    return {
      mode: 'nodejs-render-ppt',
      pptxPath: readRequiredArg(argv, '--pptx-path'),
      fontPath: readRequiredArg(argv, '--font-path'),
      fontFileName: readRequiredArg(argv, '--font-file-name'),
      outputFile: readRequiredArg(argv, '--output-file'),
      renderWidth: Number.parseInt(readRequiredArg(argv, '--render-width'), 10),
      logFile: readRequiredArg(argv, '--log-file'),
    }
  }

  let outputDir = defaultOutputDir
  let skipBuild = false
  let timeoutMs = 420_000
  let text = DEFAULT_TEST_TEXT

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output-dir') {
      outputDir = path.resolve(readArgValue(argv, index, '--output-dir'))
      index += 1
      continue
    }
    if (arg === '--skip-build') {
      skipBuild = true
      continue
    }
    if (arg === '--timeout-ms') {
      const rawValue = readArgValue(argv, index, '--timeout-ms')
      const value = Number(rawValue)
      if (!Number.isFinite(value) || value <= 0) throw new Error('请为 --timeout-ms 提供有效的正整数')
      timeoutMs = value
      index += 1
      continue
    }
    if (arg === '--text') {
      text = readArgValue(argv, index, '--text')
      index += 1
      continue
    }
    throw new Error(`不支持的参数：${arg}`)
  }

  return { mode: 'main', outputDir, skipBuild, timeoutMs, text }
}

function readRequiredArg(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index < 0) throw new Error(`缺少参数：${flag}`)
  return readArgValue(argv, index, flag)
}

function readArgValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺少 ${flag} 的参数值`)
  return value
}

function resolveBunCommand(): string {
  const execName = path.basename(process.execPath).toLowerCase()
  if (execName.includes('bun')) return process.execPath

  const candidates = [
    process.env.BUN_PATH,
    path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
    'bun',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === 'bun') return candidate
    if (existsSync(candidate)) return candidate
  }

  return 'bun'
}

function resolveBrowserExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.LAST_VERSION_PPT_CHROME_PATH
  if (envPath && existsSync(envPath)) return envPath

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
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && existsSync(candidate)) return candidate
  }
  return undefined
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

function createTextFileLogger(filePath: string) {
  return (message: string) => {
    appendFileSync(filePath, message.endsWith('\n') ? message : `${message}\n`, 'utf8')
  }
}

function getCssFontFormat(font: Pick<FontAsset, 'mimeType' | 'fileName'>): string {
  if (font.mimeType === 'font/woff2' || font.fileName.endsWith('.woff2')) return 'woff2'
  if (font.mimeType === 'font/woff' || font.fileName.endsWith('.woff')) return 'woff'
  if (font.mimeType === 'font/ttf' || font.fileName.endsWith('.ttf')) return 'truetype'
  return 'opentype'
}

async function delay(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForHealth(timeoutMs: number, sessionLog: (message: string) => void) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${serverOrigin}/api/health`)
      if (response.ok) {
        sessionLog('后端已经就绪。')
        return
      }
    } catch {
      // Ignore while waiting for the server to boot.
    }
    await delay(1_000)
  }
  throw new Error('等待后端启动超时')
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`请求失败（${response.status}）：${text || response.statusText}`)
  }
  return await response.json() as T
}

async function prepareBundledFont(outputDir: string, sessionLog: (message: string) => void): Promise<FontAsset> {
  if (!existsSync(bundledFontPath)) {
    throw new Error(`仓库内缺少测试字体：${bundledFontPath}`)
  }
  const fontsDir = ensureDir(path.join(outputDir, 'fonts'))
  const filePath = path.join(fontsDir, FONT_FILE_NAME)
  copyFileSync(bundledFontPath, filePath)
  const buffer = readFileSync(filePath)
  sessionLog(`已使用仓库内置测试字体：${bundledFontPath}`)
  sessionLog(`测试字体已复制到输出目录：${filePath}`)

  return {
    fileName: FONT_FILE_NAME,
    family: FONT_FAMILY,
    mimeType: FONT_MIME_TYPE,
    filePath,
    buffer,
    dataUrl: `data:${FONT_MIME_TYPE};base64,${buffer.toString('base64')}`,
    size: buffer.length,
    sourcePath: bundledFontPath,
  }
}

function buildProjectScript(text: string) {
  return `module.exports = async function buildPresentation({ pptx, measureText, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'ppt text canvas cv test';
  pptx.subject = '中文文字宽度核对';
  pptx.title = '中文文字宽度核对';
  const fontFace = '${FONT_FAMILY}';
  const textValue = ${JSON.stringify(text)};
  const metrics = await measureText(textValue, { fontSize: ${FONT_SIZE_PT}, fontFace, width: 11.0 });
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addText(textValue, {
    x: 1.0,
    y: 2.0,
    w: 11.0,
    h: metrics.safeHeight,
    fontFace,
    fontSize: ${FONT_SIZE_PT},
    margin: 0,
    breakLine: false,
    color: '000000',
  });
  log({
    kind: 'text-metrics',
    text: textValue,
    fontFace,
    fontSize: ${FONT_SIZE_PT},
    width: metrics.width,
    widthInches: metrics.widthInches,
    height: metrics.height,
    safeHeight: metrics.safeHeight,
    lineHeight: metrics.lineHeight,
    lines: metrics.lines,
  });
};`
}

function startBackend(outputDir: string) {
  const stdoutLog = createTextFileLogger(path.join(outputDir, 'backend-stdout.log'))
  const stderrLog = createTextFileLogger(path.join(outputDir, 'backend-stderr.log'))
  const child = spawn(resolveBunCommand(), ['run', 'src/index.ts'], {
    cwd: backendDir,
    env: { ...process.env, NO_OPEN_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as unknown as ChildProcessWithoutNullStreams

  child.stdout.on('data', chunk => stdoutLog(chunk.toString()))
  child.stderr.on('data', chunk => stderrLog(chunk.toString()))

  return child
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null, sessionLog: (message: string) => void) {
  if (!child || child.killed) return
  sessionLog('正在停止后端进程…')
  child.kill('SIGTERM')
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, PROCESS_KILL_TIMEOUT_MS)
    child.once('close', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

async function createProject(projectScript: string, sessionLog: (message: string) => void) {
  const projectName = `中文文字宽度核对-${Date.now()}`
  sessionLog(`正在创建测试项目：${projectName}`)
  const project = await readJson<ProjectResponse>(await fetch(`${serverOrigin}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName }),
  }))

  await readJson<{ success: boolean }>(await fetch(`${serverOrigin}/api/projects/${encodeURIComponent(project.id)}/files/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'index.js', content: projectScript }),
  }))

  return project
}

async function downloadExportedPptx(projectId: string, outputDir: string, sessionLog: (message: string) => void) {
  const response = await fetch(`${serverOrigin}/api/projects/${encodeURIComponent(projectId)}/export`)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`下载 PPT 失败（${response.status}）：${message || response.statusText}`)
  }
  const filePath = path.join(outputDir, 'text-width-check.pptx')
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  sessionLog(`PPT 文件已保存：${filePath}`)
  return filePath
}

function formatConsoleMessage(message: ConsoleMessage, values: unknown[]) {
  const location = message.location()
  const suffix = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : ''
  const detail = values.length > 0 ? ` ${values.map(value => stringifyValue(value)).join(' ')}` : ''
  return `[${new Date().toISOString()}] [${message.type()}] ${message.text()}${detail}${suffix}`
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function shortenUrl(url: string, maxLength = 240) {
  if (!url) return url
  if (url.startsWith('data:')) {
    return `${url.slice(0, 64)}… [data-url ${url.length} chars]`
  }
  if (url.length <= maxLength) return url
  return `${url.slice(0, maxLength)}… [${url.length} chars]`
}

async function readConsoleValues(message: ConsoleMessage) {
  const values: unknown[] = []
  for (const handle of message.args()) {
    try {
      values.push(await handle.jsonValue())
    } catch {
      values.push('[无法读取的控制台参数]')
    }
  }
  return values
}

function attachPageLogging(page: Page, outputDir: string, prefix: string) {
  const browserConsoleLog = createTextFileLogger(path.join(outputDir, `${prefix}-browser-console.log`))
  const browserErrorLog = createTextFileLogger(path.join(outputDir, `${prefix}-browser-errors.log`))
  const networkLog = createTextFileLogger(path.join(outputDir, `${prefix}-network.log`))

  page.on('console', async message => {
    const values = await readConsoleValues(message)
    browserConsoleLog(formatConsoleMessage(message, values))
  })
  page.on('pageerror', error => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    browserErrorLog(`[${new Date().toISOString()}] [pageerror] ${message}`)
  })
  page.on('request', request => {
    networkLog(`[${new Date().toISOString()}] [request] ${request.method()} ${shortenUrl(request.url())}`)
  })
  page.on('response', response => {
    networkLog(`[${new Date().toISOString()}] [response] ${response.status()} ${shortenUrl(response.url())}`)
  })
  page.on('requestfailed', request => {
    networkLog(`[${new Date().toISOString()}] [failed] ${request.method()} ${shortenUrl(request.url())} ${request.failure()?.errorText || ''}`)
  })
}

function buildCanvasHtml(font: FontAsset, text: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canvas 文字宽度核对</title>
    <style>
      @font-face {
        font-family: '${font.family}';
        src: url('${font.dataUrl}') format('${getCssFontFormat(font)}');
        font-display: block;
      }
      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family: '${font.family}', sans-serif;
      }
      .wrap {
        padding: 24px;
      }
      .meta {
        margin-bottom: 12px;
        font-size: 14px;
        line-height: 1.8;
      }
      canvas {
        display: block;
        width: ${CANVAS_WIDTH}px;
        height: ${CANVAS_HEIGHT}px;
        border: 1px solid #cbd5e1;
        background: white;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="meta">字体：${font.family} / 字号：${FONT_SIZE_PT}pt / 文案：${text}</div>
      <canvas id="text-canvas" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}"></canvas>
    </div>
  </body>
</html>`
}

async function saveCanvasArtifacts(page: Page, outputDir: string, font: FontAsset, text: string) {
  await page.setViewport({ width: CANVAS_WIDTH + 80, height: CANVAS_HEIGHT + 120, deviceScaleFactor: 1 })
  const html = buildCanvasHtml(font, text)
  writeFileSync(path.join(outputDir, 'canvas-render.html'), html, 'utf8')
  await page.setContent(html, { waitUntil: 'load' })

  const result = await page.evaluate(async ({ fontFamily, fontSizePx, text, threshold, leftPx, baselinePx }) => {
    function detectBoundingBox(data: Uint8ClampedArray, width: number, height: number, scanThreshold: number) {
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4
          const alpha = data[offset + 3]
          const red = data[offset]
          const green = data[offset + 1]
          const blue = data[offset + 2]
          if (alpha > 0 && (red < scanThreshold || green < scanThreshold || blue < scanThreshold)) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }

      if (maxX < minX || maxY < minY) return null
      return {
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      }
    }

    const canvas = document.getElementById('text-canvas') as HTMLCanvasElement | null
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('无法创建 canvas 上下文')

    await document.fonts.load(`${fontSizePx}px "${fontFamily}"`)
    await document.fonts.ready

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = `${fontSizePx}px "${fontFamily}", sans-serif`
    context.textBaseline = 'alphabetic'
    context.fillStyle = '#000000'
    const metrics = context.measureText(text)
    context.fillText(text, leftPx, baselinePx)

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    return {
      metrics: {
        advanceWidthPx: metrics.width,
        occupiedWidthPx: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        actualBoundingBoxLeft: metrics.actualBoundingBoxLeft,
        actualBoundingBoxRight: metrics.actualBoundingBoxRight,
        actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
        actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
      },
      raster: {
        width: canvas.width,
        height: canvas.height,
        boundingBox: detectBoundingBox(imageData.data, canvas.width, canvas.height, threshold),
        imageDataUrl: canvas.toDataURL('image/png'),
      },
    }
  }, {
    fontFamily: font.family,
    fontSizePx: FONT_SIZE_PX,
    text,
    threshold: CV_THRESHOLD,
    leftPx: TEXT_LEFT_PX,
    baselinePx: TEXT_BASELINE_PX,
  }) as { metrics: CanvasMetrics; raster: RasterAnalysisResult }

  writeFileSync(
    path.join(outputDir, 'canvas-render.png'),
    Buffer.from(result.raster.imageDataUrl.replace(/^data:image\/png;base64,/u, ''), 'base64'),
  )
  writeFileSync(path.join(outputDir, 'canvas-metrics.json'), JSON.stringify(result, null, 2), 'utf8')
  return result
}

async function loadAndAnalyzeImage(
  page: Page,
  dataUrl: string,
  width: number,
  height: number,
): Promise<RasterAnalysisResult> {
  return await page.evaluate(async ({ imageDataUrl, width, height, threshold }) => {
    function detectBoundingBox(data: Uint8ClampedArray, rasterWidth: number, rasterHeight: number, scanThreshold: number) {
      let minX = rasterWidth
      let minY = rasterHeight
      let maxX = -1
      let maxY = -1

      for (let y = 0; y < rasterHeight; y += 1) {
        for (let x = 0; x < rasterWidth; x += 1) {
          const offset = (y * rasterWidth + x) * 4
          const alpha = data[offset + 3]
          const red = data[offset]
          const green = data[offset + 1]
          const blue = data[offset + 2]
          if (alpha > 0 && (red < scanThreshold || green < scanThreshold || blue < scanThreshold)) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }

      if (maxX < minX || maxY < minY) return null
      return {
        left: minX,
        top: minY,
        right: maxX,
        bottom: maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      }
    }

    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片加载失败'))
    })
    image.src = imageDataUrl
    await loaded

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片分析画布')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)

    return {
      width,
      height,
      boundingBox: detectBoundingBox(imageData.data, width, height, threshold),
      imageDataUrl: canvas.toDataURL('image/png'),
    }
  }, {
    imageDataUrl: dataUrl,
    width,
    height,
    threshold: CV_THRESHOLD,
  }) as RasterAnalysisResult
}

function buildComparisonReport(args: {
  text: string
  font: FontAsset
  canvasMetrics: CanvasMetrics
  canvasRaster: RasterAnalysisResult
  pptRawRaster: RasterAnalysisResult
  pptNormalizedRaster: RasterAnalysisResult
  outputDir: string
  nodejsRenderLogPath: string
  comparison: {
    canvasOccupiedVsCanvasCvPx: number
    canvasAdvanceVsCanvasCvPx: number
    canvasCvVsPptCvPx: number
    canvasOccupiedVsPptCvPx: number
    ok: boolean
  }
}) {
  const metricRows = [
    ['Canvas measure 宽度', args.canvasMetrics.advanceWidthPx.toFixed(2)],
    ['Canvas 实占宽度', args.canvasMetrics.occupiedWidthPx.toFixed(2)],
    ['Canvas CV 宽度', String(args.canvasRaster.boundingBox?.width ?? 0)],
    ['PPT CV 宽度（按 1280×720 归一化）', String(args.pptNormalizedRaster.boundingBox?.width ?? 0)],
    ['Canvas 实占 与 Canvas CV 差值', args.comparison.canvasOccupiedVsCanvasCvPx.toFixed(2)],
    ['Canvas measure 与 Canvas CV 差值', args.comparison.canvasAdvanceVsCanvasCvPx.toFixed(2)],
    ['Canvas CV 与 PPT CV 差值', args.comparison.canvasCvVsPptCvPx.toFixed(2)],
    ['Canvas 实占 与 PPT CV 差值', args.comparison.canvasOccupiedVsPptCvPx.toFixed(2)],
  ]

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>中文文字宽度核对报告</title>
    <style>
      body {
        margin: 0;
        background: #0f172a;
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      main {
        max-width: 1400px;
        margin: 0 auto;
        padding: 24px;
      }
      .card {
        margin-bottom: 20px;
        padding: 20px;
        border-radius: 20px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.28);
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      .ok {
        color: ${args.comparison.ok ? '#22c55e' : '#f97316'};
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      td {
        padding: 10px 12px;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
        vertical-align: top;
      }
      td:first-child {
        width: 320px;
        color: #cbd5e1;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px;
      }
      img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: white;
      }
      .meta {
        line-height: 1.8;
      }
      code {
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>中文文字宽度核对报告</h1>
        <div class="meta">
          <div>结论：<span class="ok">${args.comparison.ok ? 'Canvas 与 PPT 的文字宽度已经对齐' : 'Canvas 与 PPT 的文字宽度仍有明显偏差'}</span></div>
          <div>测试字体：${args.font.family}</div>
          <div>字体文件：<code>${args.font.filePath}</code></div>
          <div>字体来源：<code>${args.font.sourcePath}</code></div>
          <div>测试文案：${args.text}</div>
          <div>Node.js 渲染日志：<code>${args.nodejsRenderLogPath}</code></div>
          <div>输出目录：<code>${args.outputDir}</code></div>
        </div>
      </section>

      <section class="card">
        <h2>数值对比</h2>
        <table>
          <tbody>
            ${metricRows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>图片对照</h2>
        <div class="grid">
          <div>
            <div style="margin-bottom: 8px;">Canvas 渲染图</div>
            <img src="./canvas-render.png" alt="Canvas 渲染图" />
          </div>
          <div>
            <div style="margin-bottom: 8px;">PPT 渲染图（归一化到 1280×720）</div>
            <img src="./ppt-render-1280x720.png" alt="PPT 渲染图" />
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`
}

async function runNodejsPptRender(options: {
  scriptPath: string
  pptxPath: string
  font: FontAsset
  outputFile: string
  logFile: string
  timeoutMs: number
  renderWidth: number
  sessionLog: (message: string) => void
}) {
  const log = createTextFileLogger(options.logFile)
  log(`[${new Date().toISOString()}] 准备在 Node.js 中调用 LibreOffice 导出 PPT 图片`)

  const child = spawn(process.execPath, [
    options.scriptPath,
    '--nodejs-render-ppt',
    '--pptx-path', options.pptxPath,
    '--font-path', options.font.filePath,
    '--font-file-name', options.font.fileName,
    '--output-file', options.outputFile,
    '--render-width', String(options.renderWidth),
    '--log-file', options.logFile,
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', chunk => log(chunk.toString()))
  child.stderr.on('data', chunk => log(chunk.toString()))

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    log(`[${new Date().toISOString()}] Node.js 渲染超时，准备终止子进程`)
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), PROCESS_KILL_TIMEOUT_MS)
  }, options.timeoutMs)

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve(code ?? 1))
  })
  clearTimeout(timeout)

  if (timedOut) {
    throw new Error('Node.js 渲染 PPT 超时')
  }
  if (exitCode !== 0) {
    throw new Error(`Node.js 渲染 PPT 失败，退出码 ${exitCode}`)
  }
  if (!existsSync(options.outputFile)) {
    throw new Error(`Node.js 渲染完成后没有找到输出图片：${options.outputFile}`)
  }

  options.sessionLog(`Node.js 导出的 PPT 图片已保存：${options.outputFile}`)
}

async function runNodejsPptRenderWorker(options: NodeRenderRunOptions) {
  ensureDir(path.dirname(options.outputFile))
  ensureDir(path.dirname(options.logFile))
  const log = createTextFileLogger(options.logFile)
  const print = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`
    log(line)
    process.stdout.write(`${line}\n`)
  }

  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve('@matbee/libreoffice-converter/package.json')
  const packageDir = path.dirname(packageJsonPath)
  print(`LibreOffice 包目录：${packageDir}`)

  const { createConverter } = await import('@matbee/libreoffice-converter')
  const wasmLoaderModule = await import('@matbee/libreoffice-converter/wasm/loader.cjs')
  const wasmLoader = 'default' in wasmLoaderModule ? wasmLoaderModule.default : wasmLoaderModule
  const converter = await createConverter({
    wasmPath: path.join(packageDir, 'wasm'),
    wasmLoader,
  })

  try {
    const moduleRef = (converter as unknown as { module?: { FS?: { mkdir: (target: string) => void; writeFile: (target: string, data: Uint8Array) => void } } }).module
    const fsRef = moduleRef?.FS
    if (!fsRef) throw new Error('LibreOffice 转换器没有暴露可写文件系统，无法安装测试字体')

    for (const dir of ['/usr', '/usr/share', '/usr/share/fonts', '/usr/share/fonts/custom']) {
      try {
        fsRef.mkdir(dir)
      } catch {
        // Ignore EEXIST.
      }
    }

    const fontData = readFileSync(options.fontPath)
    const fontTargetPath = `/usr/share/fonts/custom/${options.fontFileName}`
    fsRef.writeFile(fontTargetPath, new Uint8Array(fontData))
    print(`测试字体已写入 LibreOffice：${fontTargetPath}`)

    const pptxBuffer = readFileSync(options.pptxPath)
    const result = await converter.convert(
      pptxBuffer,
      {
        outputFormat: 'png',
        image: {
          pageIndex: 0,
          width: options.renderWidth,
        },
      },
      path.basename(options.pptxPath),
    )

    writeFileSync(options.outputFile, Buffer.from(result.data))
    writeFileSync(`${options.outputFile}.json`, JSON.stringify({
      filename: result.filename,
      mimeType: result.mimeType,
      size: result.data.length,
      outputFile: options.outputFile,
      fontPath: options.fontPath,
      renderWidth: options.renderWidth,
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8')
    print(`PPT 图片已导出：${options.outputFile}`)
  } finally {
    await converter.destroy().catch(error => {
      print(`释放 LibreOffice 资源时出现提示：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  process.exit(0)
}

async function runMain(options: MainRunOptions) {
  const outputDir = ensureDir(options.outputDir)
  const sessionLogFile = path.join(outputDir, 'session.log')
  const sessionLog = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`
    console.log(line)
    appendFileSync(sessionLogFile, `${line}\n`, 'utf8')
  }

  sessionLog(`输出目录：${outputDir}`)
  if (options.skipBuild) {
    sessionLog('当前脚本不再依赖前端预览页，已忽略 --skip-build。')
  }

  const font = await prepareBundledFont(outputDir, sessionLog)
  writeFileSync(path.join(outputDir, 'font.json'), JSON.stringify({
    fileName: font.fileName,
    family: font.family,
    filePath: font.filePath,
    size: font.size,
    sourcePath: font.sourcePath,
  }, null, 2), 'utf8')

  const browserExecutablePath = resolveBrowserExecutablePath()
  if (browserExecutablePath) {
    sessionLog(`将使用本机浏览器：${browserExecutablePath}`)
  } else {
    sessionLog('没有找到本机浏览器路径，将尝试使用 Puppeteer 自带的浏览器。')
  }

  let backendProcess: ChildProcessWithoutNullStreams | null = null
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    backendProcess = startBackend(outputDir)
    await waitForHealth(60_000, sessionLog)

    const projectScript = buildProjectScript(options.text)
    writeFileSync(path.join(outputDir, 'project-index.js'), projectScript, 'utf8')
    const project = await createProject(projectScript, sessionLog)
    const pptxPath = await downloadExportedPptx(project.id, outputDir, sessionLog)

    const browserArgs: string[] = []
    if (process.platform === 'linux' && process.env.PUPPETEER_DISABLE_SANDBOX !== '0') {
      browserArgs.push('--no-sandbox', '--disable-setuid-sandbox')
    }
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
      executablePath: browserExecutablePath,
      args: browserArgs,
      protocolTimeout: options.timeoutMs,
    })

    const canvasPage = await browser.newPage()
    attachPageLogging(canvasPage, outputDir, 'canvas')
    const canvasResult = await saveCanvasArtifacts(canvasPage, outputDir, font, options.text)

    const nodejsRenderLogPath = path.join(outputDir, 'ppt-render-nodejs.log')
    const rawImagePath = path.join(outputDir, 'ppt-render-raw.png')
    await runNodejsPptRender({
      scriptPath: fileURLToPath(import.meta.url),
      pptxPath,
      font,
      outputFile: rawImagePath,
      logFile: nodejsRenderLogPath,
      timeoutMs: options.timeoutMs,
      renderWidth: PPT_IMAGE_WIDTH,
      sessionLog,
    })

    const rawImageBuffer = readFileSync(rawImagePath)
    const rawImageDataUrl = `data:image/png;base64,${rawImageBuffer.toString('base64')}`
    const pptRawRaster = await loadAndAnalyzeImage(canvasPage, rawImageDataUrl, PPT_IMAGE_WIDTH, PPT_IMAGE_HEIGHT)
    const pptNormalizedRaster = await loadAndAnalyzeImage(canvasPage, rawImageDataUrl, CANVAS_WIDTH, CANVAS_HEIGHT)
    writeFileSync(
      path.join(outputDir, 'ppt-render-1280x720.png'),
      Buffer.from(pptNormalizedRaster.imageDataUrl.replace(/^data:image\/png;base64,/u, ''), 'base64'),
    )
    writeFileSync(path.join(outputDir, 'ppt-render-analysis.json'), JSON.stringify({
      raw: pptRawRaster,
      normalized: pptNormalizedRaster,
    }, null, 2), 'utf8')

    const canvasCvWidth = canvasResult.raster.boundingBox?.width ?? 0
    const pptCvWidth = pptNormalizedRaster.boundingBox?.width ?? 0
    const comparison = {
      canvasOccupiedVsCanvasCvPx: Math.abs(canvasResult.metrics.occupiedWidthPx - canvasCvWidth),
      canvasAdvanceVsCanvasCvPx: Math.abs(canvasResult.metrics.advanceWidthPx - canvasCvWidth),
      canvasCvVsPptCvPx: Math.abs(canvasCvWidth - pptCvWidth),
      canvasOccupiedVsPptCvPx: Math.abs(canvasResult.metrics.occupiedWidthPx - pptCvWidth),
      ok: Math.abs(canvasCvWidth - pptCvWidth) <= MAX_ALLOWED_CV_DIFF_PX,
    }

    const summary = {
      ok: comparison.ok,
      text: options.text,
      fontFamily: font.family,
      fontFile: font.filePath,
      pptxPath,
      outputDir,
      nodejsRenderLogPath,
      canvas: canvasResult,
      ppt: {
        raw: pptRawRaster,
        normalized: pptNormalizedRaster,
      },
      comparison,
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')

    const reportHtml = buildComparisonReport({
      text: options.text,
      font,
      canvasMetrics: canvasResult.metrics,
      canvasRaster: canvasResult.raster,
      pptRawRaster,
      pptNormalizedRaster,
      outputDir,
      nodejsRenderLogPath,
      comparison,
    })
    const reportPath = path.join(outputDir, 'comparison-report.html')
    writeFileSync(reportPath, reportHtml, 'utf8')

    const reportPage = await browser.newPage()
    attachPageLogging(reportPage, outputDir, 'report')
    await reportPage.goto(`file://${reportPath}`, { waitUntil: 'load', timeout: options.timeoutMs })
    const reportScreenshotPath = path.join(outputDir, 'comparison-report.png')
    await reportPage.screenshot({ path: reportScreenshotPath, fullPage: true })
    await reportPage.close()

    sessionLog(`对比报告已保存：${reportPath}`)
    sessionLog(`对比报告截图已保存：${reportScreenshotPath}`)

    if (!comparison.ok) {
      throw new Error(`文字宽度仍未对齐：Canvas CV=${canvasCvWidth}px，PPT CV=${pptCvWidth}px，差值 ${comparison.canvasCvVsPptCvPx.toFixed(2)}px`)
    }

    sessionLog('文字宽度核对完成：Canvas 与 PPT 的宽度保持一致。')
  } finally {
    if (browser) {
      await browser.close().catch(() => null)
    }
    await stopProcess(backendProcess, sessionLog)
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.mode === 'nodejs-render-ppt') {
  runNodejsPptRenderWorker(options).catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  })
} else {
  runMain(options).catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  })
}
