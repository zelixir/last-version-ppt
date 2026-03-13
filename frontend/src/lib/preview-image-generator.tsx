import type { PreviewPresentation } from '../types'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import resvgWasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url'
import { captureElementAsImageDataUrl } from './dom-to-png'
import { buildPreviewSlideSvg } from './preview-svg'

let initResvgPromise: Promise<void> | null = null
let lastPreviewImageRenderMode: 'wasm' | 'dom-fallback' = 'wasm'
const BINARY_CONVERSION_CHUNK_SIZE = 0x8000

function toDataUrl(bytes: Uint8Array, mediaType: string) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += BINARY_CONVERSION_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BINARY_CONVERSION_CHUNK_SIZE))
  }
  return `data:${mediaType};base64,${btoa(binary)}`
}

function decodeDataUrl(dataUrl: string) {
  const matched = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl)
  if (!matched) return null
  const [, mediaType = 'application/octet-stream', base64] = matched
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return { mediaType, bytes }
}

async function ensureResvgReady() {
  if (!initResvgPromise) {
    initResvgPromise = (async () => {
      const response = await fetch(resvgWasmUrl)
      if (!response.ok) {
        throw new Error(`浏览器里的出图引擎没有加载成功（HTTP ${response.status}）`)
      }
      await initWasm(await response.arrayBuffer())
    })()
  }
  await initResvgPromise
}

async function readImageBytes(src: string) {
  const inline = decodeDataUrl(src)
  if (inline) return inline.bytes

  const response = await fetch(src)
  if (!response.ok) throw new Error(`加载幻灯片里的图片失败：${src}（HTTP ${response.status}）`)
  return new Uint8Array(await response.arrayBuffer())
}

async function capturePreviewImagesWithDom(presentation: PreviewPresentation) {
  lastPreviewImageRenderMode = 'dom-fallback'
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const { default: SlideCanvas } = await import('../components/SlideCanvas')
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1280px',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  })
  document.body.appendChild(host)

  const root = createRoot(host)

  try {
    const images: string[] = []
    for (const slide of presentation.slides) {
      flushSync(() => {
        root.render(
          <div style={{ width: '1280px' }}>
            <SlideCanvas slide={slide} presentation={presentation} />
          </div>,
        )
      })
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const element = host.querySelector<HTMLElement>('[data-slide-canvas="true"]')
      if (!element) throw new Error('预览页面还没准备好，暂时不能生成预览图')
      images.push(await captureElementAsImageDataUrl(element))
    }
    return images
  } finally {
    root.unmount()
    host.remove()
  }
}

export function getLastPreviewImageRenderMode() {
  return lastPreviewImageRenderMode
}

export async function capturePreviewImages(presentation: PreviewPresentation) {
  try {
    await ensureResvgReady()
    lastPreviewImageRenderMode = 'wasm'
    const images: string[] = []
    for (const slide of presentation.slides) {
      const { svg, imageAssets, width } = buildPreviewSlideSvg(presentation, slide)
      const imageAssetMap = new Map(imageAssets.map(asset => [asset.href, asset.src]))
      const renderer = new Resvg(svg, {
        fitTo: { mode: 'width', value: width },
        background: '#FFFFFF',
      })

      try {
        for (const href of renderer.imagesToResolve()) {
          const src = imageAssetMap.get(String(href))
          if (!src) continue
          renderer.resolveImage(String(href), await readImageBytes(src))
        }
        const rendered = renderer.render()
        try {
          images.push(toDataUrl(rendered.asPng(), 'image/png'))
        } finally {
          rendered.free()
        }
      } finally {
        renderer.free()
      }
    }
    return images
  } catch (error) {
    console.warn('WASM 预览出图失败，改用浏览器截图继续生成。', error)
    return capturePreviewImagesWithDom(presentation)
  }
}
