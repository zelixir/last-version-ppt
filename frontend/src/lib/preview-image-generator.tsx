import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import SlideCanvas from '../components/SlideCanvas'
import type { PreviewPresentation } from '../types'
import { captureElementAsImageDataUrl } from './dom-to-png'

function waitForRenderedSlide() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

export async function capturePreviewImages(presentation: PreviewPresentation) {
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
      await waitForRenderedSlide()
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
