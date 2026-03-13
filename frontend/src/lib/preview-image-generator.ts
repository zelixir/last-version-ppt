import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SlideCanvas from '../components/SlideCanvas'
import { captureElementAsImageDataUrl } from './dom-to-png'
import type { PreviewPresentation, PreviewSlide } from '../types'

const PREVIEW_WIDTH = 1600

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

interface UploadedPreviewImage {
  pageNumber: number
  url: string
}

interface CapturePreviewImagesOptions {
  presentation: PreviewPresentation
  onProgress?: (progress: PreviewProgressStatus) => void
}

function dataUrlToBlob(dataUrl: string) {
  return fetch(dataUrl).then(response => {
    if (!response.ok) throw new Error('预览图片生成失败，请稍后再试')
    return response.blob()
  })
}

function waitForSlideElement(container: HTMLElement) {
  return new Promise<HTMLElement>((resolve, reject) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const slideElement = container.querySelector('[data-slide-canvas="true"]')
        if (slideElement instanceof HTMLElement) {
          resolve(slideElement)
          return
        }
        reject(new Error('浏览器里没有准备好可导出的预览内容'))
      })
    })
  })
}

function createRenderHost(presentation: PreviewPresentation) {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${PREVIEW_WIDTH}px`
  host.style.pointerEvents = 'none'
  host.style.opacity = '0'
  host.style.zIndex = '-1'
  host.style.background = '#ffffff'
  host.style.contain = 'layout paint size'
  host.style.aspectRatio = `${presentation.width}/${presentation.height}`
  document.body.append(host)
  return host
}

async function renderSlideToBlob(root: Root, host: HTMLElement, slide: PreviewSlide, presentation: PreviewPresentation) {
  root.render(createElement(SlideCanvas, { slide, presentation }))
  const slideElement = await waitForSlideElement(host)
  const dataUrl = await captureElementAsImageDataUrl(slideElement)
  return dataUrlToBlob(dataUrl)
}

export async function capturePreviewImages(
  options: CapturePreviewImagesOptions,
) {
  const { presentation, onProgress } = options
  const pageCount = presentation.slides.length
  const images: Blob[] = []
  const host = createRenderHost(presentation)
  const root = createRoot(host)

  try {
    onProgress?.({ message: '正在准备浏览器预览图…', percent: 0 })
    for (let index = 0; index < pageCount; index += 1) {
      const currentPage = index + 1
      onProgress?.({
        message: `正在生成第 ${currentPage} / ${pageCount} 页预览图…`,
        percent: Math.round((currentPage / Math.max(pageCount, 1)) * 100),
      })
      images.push(await renderSlideToBlob(root, host, presentation.slides[index], presentation))
    }
  } finally {
    root.unmount()
    host.remove()
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
