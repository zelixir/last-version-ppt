import { WorkerBrowserConverter, createWasmPaths, type WasmLoadProgress } from '@matbee/libreoffice-converter/browser'
import { loadSystemFonts, uploadFontsToWorker } from './system-fonts'

const LIBREOFFICE_WORKER_PATH = '/libreoffice/font-worker-wrapper.js'

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

type LibreOfficeEnvState = 'idle' | 'initializing' | 'ready' | 'destroying' | 'error'

interface LibreOfficeEnvStateSnapshot {
  state: LibreOfficeEnvState
  generation: number
  converter: WorkerBrowserConverter | null
  initPromise: Promise<WorkerBrowserConverter> | null
  destroyPromise: Promise<void> | null
  error: unknown | null
}

const sharedProgressListeners = new Set<(progress: PreviewProgressStatus) => void>()
const sharedState: LibreOfficeEnvStateSnapshot = {
  state: 'idle',
  generation: 0,
  converter: null,
  initPromise: null,
  destroyPromise: null,
  error: null,
}

let lifecycleHooksInstalled = false

function emitProgress(progress: PreviewProgressStatus) {
  sharedProgressListeners.forEach(listener => listener(progress))
}

export function phaseToMessage(progress: WasmLoadProgress) {
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

async function safeDestroyConverter(converter: WorkerBrowserConverter | null | undefined) {
  if (!converter) return
  try {
    await converter.destroy()
  } catch {
    // Ignore teardown errors; the next initialization should still be allowed to continue.
  }
}

function installLifecycleHooks() {
  if (lifecycleHooksInstalled || typeof window === 'undefined') return
  lifecycleHooksInstalled = true

  const handlePageHide = () => {
    sharedState.generation += 1
    sharedState.state = 'idle'
    sharedState.error = null
    sharedState.initPromise = null
    const activeConverter = sharedState.converter
    sharedState.converter = null
    if (activeConverter) void safeDestroyConverter(activeConverter)
  }

  window.addEventListener('pagehide', handlePageHide)
}

async function waitForDestroyIfNeeded() {
  if (sharedState.destroyPromise) {
    await sharedState.destroyPromise.catch(() => undefined)
  }
}

async function resetLibreOfficeEnvironment() {
  sharedState.generation += 1
  sharedState.error = null
  sharedState.initPromise = null

  await waitForDestroyIfNeeded()

  const activeConverter = sharedState.converter
  sharedState.converter = null
  if (!activeConverter) {
    sharedState.state = 'idle'
    return
  }

  sharedState.state = 'destroying'
  const destroyPromise = safeDestroyConverter(activeConverter)
    .finally(() => {
      if (sharedState.destroyPromise === destroyPromise) {
        sharedState.destroyPromise = null
        sharedState.state = 'idle'
      }
    })

  sharedState.destroyPromise = destroyPromise
  await destroyPromise
}

async function createConverter(generation: number) {
  const fontsPromise = loadSystemFonts()
  const converter = new WorkerBrowserConverter({
    ...createWasmPaths('/wasm/'),
    browserWorkerJs: LIBREOFFICE_WORKER_PATH,
    onProgress: progress => emitProgress({ message: phaseToMessage(progress), percent: progress.percent }),
  })

  await converter.initialize()
  if (generation !== sharedState.generation) {
    await safeDestroyConverter(converter)
    throw new Error('高保真预览环境已经失效，正在重新准备。')
  }

  try {
    await fontsPromise
    const worker = (converter as unknown as { worker?: Worker }).worker
    if (worker) await uploadFontsToWorker(worker)
  } catch {
    // Font loading is best-effort; continue without fonts
  }

  return converter
}

async function ensureReadyConverter() {
  installLifecycleHooks()

  if (sharedState.state === 'ready' && sharedState.converter) {
    return sharedState.converter
  }

  if (sharedState.initPromise) {
    return await sharedState.initPromise
  }

  await waitForDestroyIfNeeded()

  sharedState.generation += 1
  const currentGeneration = sharedState.generation
  sharedState.state = 'initializing'
  sharedState.error = null

  const initPromise = createConverter(currentGeneration)
    .then(converter => {
      if (currentGeneration !== sharedState.generation) {
        return safeDestroyConverter(converter)
          .then(() => Promise.reject(new Error('高保真预览环境已经失效，正在重新准备。')))
      }
      sharedState.converter = converter
      sharedState.state = 'ready'
      sharedState.initPromise = null
      return converter
    })
    .catch(error => {
      if (currentGeneration === sharedState.generation) {
        sharedState.converter = null
        sharedState.initPromise = null
        sharedState.error = error
        sharedState.state = 'error'
      }
      throw error
    })

  sharedState.initPromise = initPromise
  return await initPromise
}

async function getLibreOfficeConverterInternal(allowRetry: boolean) {
  try {
    return await ensureReadyConverter()
  } catch (error) {
    if (!allowRetry) throw error
    emitProgress({ message: '首次启动没有完成，正在重新准备高保真预览引擎…' })
    await resetLibreOfficeEnvironment()
    return await getLibreOfficeConverterInternal(false)
  }
}

export async function getLibreOfficeConverter(onProgress?: (progress: PreviewProgressStatus) => void) {
  if (onProgress) sharedProgressListeners.add(onProgress)

  try {
    const converter = await getLibreOfficeConverterInternal(true)
    onProgress?.({ message: '高保真预览引擎已经准备好了', percent: 100 })
    return converter
  } finally {
    if (onProgress) sharedProgressListeners.delete(onProgress)
  }
}

export async function warmupLibreOfficeEnvironment(onProgress?: (progress: PreviewProgressStatus) => void) {
  try {
    await getLibreOfficeConverter(onProgress)
  } catch {
    // Let the real preview flow surface initialization errors to the user.
  }
}
