import { getLibreOfficeConverter, type PreviewProgressStatus, warmupLibreOfficeEnvironment } from './libreoffice-env'
const PREVIEW_WIDTH = 1600
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface UploadedPreviewImage {
  pageNumber: number
  url: string
}

let pendingPreviewTaskCount = 0
let previewTaskQueue: Promise<void> = Promise.resolve()

export async function warmupPreviewEngine(onProgress?: (progress: PreviewProgressStatus) => void) {
  await warmupLibreOfficeEnvironment(onProgress)
}

async function runPreviewTask<T>(
  task: () => Promise<T>,
  onProgress?: (progress: PreviewProgressStatus) => void,
) {
  const shouldWait = pendingPreviewTaskCount > 0
  pendingPreviewTaskCount += 1
  if (shouldWait) {
    onProgress?.({ message: '前一个预览还在处理，马上就会继续…' })
  }

  const previousTask = previewTaskQueue
  let releaseCurrentTask = () => {}
  // 先把当前任务挂到队尾，再等待上一个任务结束，这样每次只会有一个 LibreOffice 预览任务进入执行区。
  previewTaskQueue = new Promise(resolve => {
    releaseCurrentTask = resolve
  })

  await previousTask.catch(() => undefined)

  try {
    return await task()
  } finally {
    pendingPreviewTaskCount = Math.max(0, pendingPreviewTaskCount - 1)
    releaseCurrentTask()
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
  return await runPreviewTask(async () => {
    const converter = await getLibreOfficeConverter(onProgress)
    const pageCount = await converter.getPageCount(pptxData, { inputFormat: 'pptx' })
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
  }, onProgress)
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
