import { WorkerBrowserConverter, createWasmPaths, type WasmLoadProgress } from '@matbee/libreoffice-converter/browser'
import { uploadFontsToWorker, loadSystemFonts } from './system-fonts'

const LIBREOFFICE_WORKER_PATH = '/libreoffice/font-worker-wrapper.js'
const GLOBAL_ENVIRONMENT_KEY = '__LAST_VERSION_PPT_LIBREOFFICE_ENV__'

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

interface LibreOfficeEnvironmentState {
  converterPromise: Promise<WorkerBrowserConverter> | null
  progressListeners: Set<(progress: PreviewProgressStatus) => void>
  lastProgress: PreviewProgressStatus | null
  pendingPreviewTaskCount: number
  previewTaskQueue: Promise<void>
}

type ConverterFactory = () => Promise<WorkerBrowserConverter>

let converterFactory: ConverterFactory = createPreviewConverter

function getEnvironmentState() {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_ENVIRONMENT_KEY]?: LibreOfficeEnvironmentState
  }

  if (!globalScope[GLOBAL_ENVIRONMENT_KEY]) {
    globalScope[GLOBAL_ENVIRONMENT_KEY] = {
      converterPromise: null,
      progressListeners: new Set(),
      lastProgress: null,
      pendingPreviewTaskCount: 0,
      previewTaskQueue: Promise.resolve(),
    }
  }

  return globalScope[GLOBAL_ENVIRONMENT_KEY]
}

function emitProgress(progress: PreviewProgressStatus) {
  const state = getEnvironmentState()
  state.lastProgress = progress
  state.progressListeners.forEach(listener => listener(progress))
}

function getConverterWorker(converter: WorkerBrowserConverter) {
  return (converter as unknown as { worker?: Worker }).worker
}

function phaseToMessage(progress: WasmLoadProgress) {
  const percent = Number.isFinite(progress.percent) ? `（${Math.round(progress.percent)}%）` : ''
  switch (progress.phase) {
    case 'download-wasm':
      return `正在下载高保真预览组件${percent}`
    case 'download-data':
      return `正在准备排版资源${percent}`
    case 'compile':
      return `正在启动预览引擎${percent}`
    case 'filesystem':
      return `正在整理预览环境${percent}`
    case 'lok-init':
      return `正在唤醒排版引擎${percent}`
    case 'ready':
      return '高保真预览引擎已经准备好了'
    default:
      return progress.message?.trim() || '正在准备高保真预览…'
  }
}

async function installFonts(converter: WorkerBrowserConverter) {
  try {
    const worker = getConverterWorker(converter)
    if (worker) await uploadFontsToWorker(worker)
  } catch {
    // Font loading is best-effort; continue without fonts
  }
}

async function createPreviewConverter() {
  const fontsPromise = loadSystemFonts()
  const converter = new WorkerBrowserConverter({
    ...createWasmPaths('/wasm/'),
    browserWorkerJs: LIBREOFFICE_WORKER_PATH,
    onProgress: progress => emitProgress({ message: phaseToMessage(progress), percent: progress.percent }),
  })

  try {
    await converter.initialize()
    try {
      await fontsPromise
      await installFonts(converter)
    } catch {
      // Font loading is best-effort; continue without fonts
    }
    return converter
  } catch (error) {
    const worker = getConverterWorker(converter)
    worker?.terminate?.()
    throw error
  }
}

export async function getPreviewConverter(onProgress?: (progress: PreviewProgressStatus) => void) {
  const state = getEnvironmentState()
  if (onProgress) {
    state.progressListeners.add(onProgress)
    if (state.lastProgress) onProgress(state.lastProgress)
  }

  try {
    if (!state.converterPromise) {
      state.converterPromise = converterFactory().catch(error => {
        const latestState = getEnvironmentState()
        latestState.converterPromise = null
        throw error
      })
    }

    const converter = await state.converterPromise
    const readyProgress = { message: '高保真预览引擎已经准备好了', percent: 100 }
    emitProgress(readyProgress)
    return converter
  } finally {
    if (onProgress) state.progressListeners.delete(onProgress)
  }
}

export async function warmupPreviewEnvironment(onProgress?: (progress: PreviewProgressStatus) => void) {
  try {
    await getPreviewConverter(onProgress)
  } catch {
    // Let the real preview flow surface initialization errors to the user.
  }
}

export async function runPreviewTaskWithEnvironment<T>(
  task: (converter: WorkerBrowserConverter) => Promise<T>,
  onProgress?: (progress: PreviewProgressStatus) => void,
) {
  const state = getEnvironmentState()
  const shouldWait = state.pendingPreviewTaskCount > 0
  state.pendingPreviewTaskCount += 1
  if (shouldWait) {
    onProgress?.({ message: '前一个预览还在处理，马上就会继续…' })
  }

  const previousTask = state.previewTaskQueue
  let releaseCurrentTask = () => {}
  state.previewTaskQueue = new Promise(resolve => {
    releaseCurrentTask = resolve
  })

  await previousTask.catch(() => undefined)

  try {
    const converter = await getPreviewConverter(onProgress)
    return await task(converter)
  } finally {
    const latestState = getEnvironmentState()
    latestState.pendingPreviewTaskCount = Math.max(0, latestState.pendingPreviewTaskCount - 1)
    releaseCurrentTask()
  }
}

export function __setPreviewConverterFactoryForTests(factory: ConverterFactory) {
  converterFactory = factory
}

export function __resetLibreOfficeEnvironmentForTests() {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_ENVIRONMENT_KEY]?: LibreOfficeEnvironmentState
  }
  delete globalScope[GLOBAL_ENVIRONMENT_KEY]
  converterFactory = createPreviewConverter
}
