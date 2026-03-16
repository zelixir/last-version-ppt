import { WorkerBrowserConverter, createWasmPaths, type WasmLoadProgress } from '@matbee/libreoffice-converter/browser'
import { uploadFontsToWorker, loadSystemFonts } from './system-fonts'

const LIBREOFFICE_WORKER_PATH = '/libreoffice/font-worker-wrapper.js'
const PREVIEW_WIDTH = 1600
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

interface UploadedPreviewImage {
  pageNumber: number
  url: string
}

let sharedConverterPromise: Promise<WorkerBrowserConverter> | null = null
const sharedProgressListeners = new Set<(progress: PreviewProgressStatus) => void>()

function emitProgress(progress: PreviewProgressStatus) {
  sharedProgressListeners.forEach(listener => listener(progress))
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

async function getPreviewConverter(onProgress?: (progress: PreviewProgressStatus) => void) {
  if (onProgress) sharedProgressListeners.add(onProgress)

  if (!sharedConverterPromise) {
    console.info('[Preview] 将使用 @matbee/libreoffice-converter 生成高保真预览图')
    // Start loading system fonts in parallel with converter initialization
    const fontsPromise = loadSystemFonts()

    const converter = new WorkerBrowserConverter({
      ...createWasmPaths('/wasm/'),
      browserWorkerJs: LIBREOFFICE_WORKER_PATH,
      onProgress: progress => emitProgress({ message: phaseToMessage(progress), percent: progress.percent }),
    })

    sharedConverterPromise = converter.initialize()
      .then(async () => {
        // After init, upload system fonts into the WASM virtual filesystem.
        // NOTE: WorkerBrowserConverter does not expose a public font API, so we
        // access its internal Worker instance as a temporary workaround until
        // the library provides an official mechanism.
        try {
          const fonts = await fontsPromise
          const worker = (converter as any).worker as Worker | undefined
          if (worker && fonts.length) {
            console.info(`[Preview] 准备把 ${fonts.length} 个系统字体文件交给 LibreOffice`)
            await uploadFontsToWorker(worker)
          } else {
            console.warn('[Preview] 当前没有可交给 LibreOffice 的系统字体文件')
          }
        } catch (error) {
          console.warn('[Preview] 系统字体未能成功装入 LibreOffice，将继续尝试渲染', error)
        }
        return converter
      })
      .catch(error => {
        sharedConverterPromise = null
        throw error
      })
  }

  try {
    const converter = await sharedConverterPromise
    onProgress?.({ message: '高保真预览引擎已经准备好了', percent: 100 })
    return converter
  } finally {
    if (onProgress) sharedProgressListeners.delete(onProgress)
  }
}

async function imageDataToPngBlob(data: Uint8Array, width: number, height: number) {
  if (isPngData(data)) {
    return new Blob([Uint8Array.from(data)], { type: 'image/png' })
  }

  if (data.length % 4 !== 0) {
    throw new Error('高保真预览返回了无法识别的图片数据，请稍后再试')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持生成预览图片')

  const clamped = Uint8ClampedArray.from(data)
  context.putImageData(new ImageData(clamped, width, height), 0, 0)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('预览图片生成失败，请稍后再试')
  return blob
}

function isPngData(data: Uint8Array) {
  return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => data[index] === byte)
}

export async function capturePreviewImages(
  pptxData: Uint8Array,
  onProgress?: (progress: PreviewProgressStatus) => void,
) {
  const converter = await getPreviewConverter(onProgress)
  const pageCount = await converter.getPageCount(pptxData, { inputFormat: 'pptx' })
  console.info(`[Preview] LibreOffice 已识别到 ${pageCount} 页，开始逐页渲染`)
  const images: Blob[] = []

  for (let index = 0; index < pageCount; index += 1) {
    const currentPage = index + 1
    onProgress?.({
      message: `正在生成第 ${currentPage} / ${pageCount} 页高保真预览图…`,
      percent: Math.round((currentPage / Math.max(pageCount, 1)) * 100),
    })
    const preview = await converter.renderPageViaConvert(pptxData, { inputFormat: 'pptx' }, index, PREVIEW_WIDTH)
    images.push(preview.isPng || isPngData(preview.data)
      ? new Blob([Uint8Array.from(preview.data)], { type: 'image/png' })
      : await imageDataToPngBlob(preview.data, preview.width, preview.height))
  }

  return images
}

export async function uploadPreviewImages(
  projectId: string,
  images: Blob[],
  onProgress?: (progress: PreviewProgressStatus) => void,
) {
  onProgress?.({ message: '正在保存预览图，稍后就能直接打开…' })

  const formData = new FormData()
  images.forEach((image, index) => {
    formData.append('files', new File([image], `slide-${index + 1}.png`, { type: 'image/png' }))
  })

  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-images`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || '保存预览图失败')
  }

  const data = await response.json() as { images?: UploadedPreviewImage[] }
  return (data.images ?? []).sort((a, b) => a.pageNumber - b.pageNumber).map(image => image.url)
}
