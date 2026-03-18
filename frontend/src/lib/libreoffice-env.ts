/**
 * LibreOffice 环境管理器 — 独立的全局单例。
 *
 * 设计目标：
 *  1. 全局只初始化一次 WorkerBrowserConverter，任何页面、任何导航方式都复用同一实例。
 *  2. 同一时刻最多只有一个 initialize() 在执行，后来者直接等待正在进行的 Promise。
 *  3. 初始化失败可自动重试（下次调用 getConverter() 会重新初始化）。
 *  4. 进度回调支持多个监听者（warmup 与 capturePreview 可同时订阅）。
 *  5. 与 React 生命周期完全解耦——无论 StrictMode、HMR 还是路由切换，
 *     都不会出现重复创建 Worker / WASM 实例的问题。
 */

import {
  WorkerBrowserConverter,
  createWasmPaths,
  type WasmLoadProgress,
} from '@matbee/libreoffice-converter/browser'
import { uploadFontsToWorker, loadSystemFonts } from './system-fonts'

// ─── 常量 ────────────────────────────────────────────────────────────

const LIBREOFFICE_WORKER_PATH = '/libreoffice/font-worker-wrapper.js'

// ─── 类型 ────────────────────────────────────────────────────────────

export interface LOProgress {
  message: string
  percent?: number
}

type LOState = 'idle' | 'initializing' | 'ready' | 'error'

// ─── 内部状态 ─────────────────────────────────────────────────────────

let _state: LOState = 'idle'
let _converter: WorkerBrowserConverter | null = null
let _initPromise: Promise<WorkerBrowserConverter> | null = null
let _lastError: unknown = null

const _progressListeners = new Set<(p: LOProgress) => void>()

// ─── 进度广播 ─────────────────────────────────────────────────────────

function emit(progress: LOProgress) {
  _progressListeners.forEach(fn => fn(progress))
}

// ─── 阶段 → 中文描述 ────────────────────────────────────────────────

function phaseToMessage(progress: WasmLoadProgress): string {
  const pct = Number.isFinite(progress.percent) ? `（${Math.round(progress.percent)}%）` : ''
  switch (progress.phase) {
    case 'download-wasm':
      return `正在下载高保真预览组件${pct}`
    case 'download-data':
      return `正在准备排版资源${pct}`
    case 'compile':
      return `正在启动预览引擎${pct}`
    case 'filesystem':
      return `正在整理预览环境${pct}`
    case 'lok-init':
      return `正在唤醒排版引擎${pct}`
    case 'ready':
      return '高保真预览引擎已经准备好了'
    default:
      return progress.message?.trim() || '正在准备高保真预览…'
  }
}

// ─── 核心：初始化函数（严格保证只运行一次） ──────────────────────────

function doInitialize(): Promise<WorkerBrowserConverter> {
  _state = 'initializing'
  _lastError = null

  const fontsPromise = loadSystemFonts()

  const converter = new WorkerBrowserConverter({
    ...createWasmPaths('/wasm/'),
    browserWorkerJs: LIBREOFFICE_WORKER_PATH,
    onProgress: progress => emit({ message: phaseToMessage(progress), percent: progress.percent }),
  })

  const promise = converter
    .initialize()
    .then(async () => {
      // 上传字体（best-effort）
      try {
        await fontsPromise
        const worker = (converter as any).worker as Worker | undefined
        if (worker) await uploadFontsToWorker(worker)
      } catch {
        // 字体加载失败不阻塞主流程
      }

      // 成功：保存实例
      _converter = converter
      _state = 'ready'
      emit({ message: '高保真预览引擎已经准备好了', percent: 100 })
      return converter
    })
    .catch(error => {
      // 失败：清除 promise，允许下次重试
      _state = 'error'
      _lastError = error
      _converter = null
      _initPromise = null
      throw error
    })

  _initPromise = promise
  return promise
}

// ─── 对外 API ────────────────────────────────────────────────────────

/**
 * 获取已就绪的 LibreOffice converter 实例。
 *
 * - 如果已就绪，立即返回。
 * - 如果正在初始化，等待当前初始化完成。
 * - 如果空闲或上次失败，启动新的初始化。
 * - 任何时刻只有一个初始化在执行。
 */
export async function getConverter(onProgress?: (p: LOProgress) => void): Promise<WorkerBrowserConverter> {
  if (onProgress) _progressListeners.add(onProgress)

  try {
    // 已就绪 → 直接返回
    if (_state === 'ready' && _converter) {
      onProgress?.({ message: '高保真预览引擎已经准备好了', percent: 100 })
      return _converter
    }

    // 正在初始化 → 等当前 promise
    if (_state === 'initializing' && _initPromise) {
      return await _initPromise
    }

    // 空闲 / 上次失败 → 启动初始化
    return await doInitialize()
  } finally {
    if (onProgress) _progressListeners.delete(onProgress)
  }
}

/**
 * 预热引擎（best-effort）。失败不抛错，让真正的预览流程再处理。
 */
export async function warmup(onProgress?: (p: LOProgress) => void): Promise<void> {
  try {
    await getConverter(onProgress)
  } catch {
    // 静默
  }
}

/**
 * 当前环境状态（仅用于调试/日志）。
 */
export function getState(): { state: LOState; lastError: unknown } {
  return { state: _state, lastError: _lastError }
}
