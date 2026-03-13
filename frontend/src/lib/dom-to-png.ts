function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      const details = reader.error ? `${reader.error.name}: ${reader.error.message}` : '浏览器没有返回更多信息'
      reject(reader.error ?? new Error(`读取图片内容失败：${details}`))
    }
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

function createImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'sync'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('预览图片生成失败'))
    image.src = url
  })
}

async function waitForFonts(root: HTMLElement) {
  if (!('fonts' in document)) return

  const fontRequests = [root, ...Array.from(root.querySelectorAll('*'))]
    .map(element => {
      const computed = window.getComputedStyle(element)
      const font = computed.font?.trim()
      if (!font) return null
      const text = element.textContent?.trim() || '预览文字'
      return document.fonts.load(font, text)
    })
    .filter((request): request is Promise<FontFace[]> => request !== null)

  await Promise.allSettled(fontRequests)
  await document.fonts.ready
}

function copyStylesRecursively(source: Element, target: Element) {
  const computed = window.getComputedStyle(source)
  for (const property of computed) {
    target instanceof HTMLElement && target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property))
  }

  const sourceChildren = Array.from(source.children)
  const targetChildren = Array.from(target.children)
  sourceChildren.forEach((child, index) => {
    const nextTarget = targetChildren[index]
    if (nextTarget) copyStylesRecursively(child, nextTarget)
  })
}

async function inlineImages(sourceRoot: HTMLElement, targetRoot: HTMLElement) {
  const sourceImages = Array.from(sourceRoot.querySelectorAll('img'))
  const targetImages = Array.from(targetRoot.querySelectorAll('img'))

  await Promise.all(sourceImages.map(async (sourceImage, index) => {
    const targetImage = targetImages[index]
    if (!targetImage) return

    const effectiveSrc = sourceImage.currentSrc || sourceImage.src || targetImage.getAttribute('src') || ''
    if (!effectiveSrc) return
    if (effectiveSrc.startsWith('data:')) {
      targetImage.setAttribute('src', effectiveSrc)
      return
    }

    const response = await fetch(effectiveSrc)
    if (!response.ok) throw new Error(`加载幻灯片里的图片失败：${effectiveSrc}（HTTP ${response.status}）`)
    const dataUrl = await blobToDataUrl(await response.blob())
    targetImage.setAttribute('src', dataUrl)
  }))
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(images.map(image => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      const finish = () => {
        image.removeEventListener('load', finish)
        image.removeEventListener('error', finish)
        resolve()
      }
      image.addEventListener('load', finish)
      image.addEventListener('error', finish)
    })
  }))
}

function buildSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export async function captureElementAsImageDataUrl(element: HTMLElement, pixelRatio = 2) {
  await nextFrame()
  await waitForFonts(element)
  await waitForImages(element)

  const rect = element.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))

  const clone = element.cloneNode(true) as HTMLElement
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  clone.style.margin = '0'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`

  copyStylesRecursively(element, clone)
  await inlineImages(element, clone)

  const markup = new XMLSerializer().serializeToString(clone)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject>
</svg>`

  const svgDataUrl = buildSvgDataUrl(svg)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = await createImage(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width * pixelRatio
    canvas.height = height * pixelRatio
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器暂时不能生成预览图')
    context.scale(pixelRatio, pixelRatio)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    try {
      return canvas.toDataURL('image/png')
    } catch {
      return svgDataUrl
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
