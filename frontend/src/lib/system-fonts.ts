interface SystemFontInfo {
  name: string
  size: number
  families?: string[]
}

let cachedFontList: SystemFontInfo[] | null = null
const PREFERRED_CHINESE_FONT_FAMILIES = [
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'WenQuanYi Zen Hei',
  'Microsoft YaHei',
  'SimSun',
  'PingFang SC',
]

function normalizeFontName(value: string) {
  return value.trim().toLowerCase()
}

function fallbackFamilyFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/u, '')
}

export function pickPreferredPresentationFont(fonts: SystemFontInfo[]) {
  const families = fonts.flatMap(font => {
    const fromApi = font.families?.filter(Boolean) ?? []
    return fromApi.length ? fromApi : [fallbackFamilyFromFileName(font.name)]
  })

  for (const candidate of PREFERRED_CHINESE_FONT_FAMILIES) {
    const match = families.find(family => normalizeFontName(family) === normalizeFontName(candidate))
    if (match) return match
  }

  return families.find(family => /cjk|han|hei|song|fang|kai|ming|明|黑|宋|楷/u.test(family)) ?? null
}

export async function fetchSystemFontList(): Promise<SystemFontInfo[]> {
  if (cachedFontList) return cachedFontList

  try {
    const response = await fetch('/api/system-fonts')
    if (!response.ok) return []
    const data = (await response.json()) as { fonts: SystemFontInfo[] }
    cachedFontList = data.fonts ?? []
    const preferredFont = pickPreferredPresentationFont(cachedFontList)
    console.info(
      `[Fonts] 发现 ${cachedFontList.length} 个系统字体文件${preferredFont ? `，默认中文字体将使用：${preferredFont}` : '，暂未找到明确的中文字体族名'}`,
    )
    return cachedFontList
  } catch {
    return []
  }
}

export async function fetchSystemFontData(fontName: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(`/api/system-fonts/data?name=${encodeURIComponent(fontName)}`)
    if (!response.ok) return null
    return await response.arrayBuffer()
  } catch {
    return null
  }
}

let fontsLoadedPromise: Promise<Array<{ name: string; data: ArrayBuffer }>> | null = null

export function loadSystemFonts(): Promise<Array<{ name: string; data: ArrayBuffer }>> {
  if (fontsLoadedPromise) return fontsLoadedPromise

  fontsLoadedPromise = (async () => {
    const fontList = await fetchSystemFontList()
    if (!fontList.length) {
      console.warn('[Fonts] 当前环境没有发现可加载的系统字体文件')
      return []
    }

    const loaded: Array<{ name: string; data: ArrayBuffer }> = []

    // Load fonts in parallel batches to avoid overwhelming the server
    const BATCH_SIZE = 4
    for (let i = 0; i < fontList.length; i += BATCH_SIZE) {
      const batch = fontList.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (font) => {
          const data = await fetchSystemFontData(font.name)
          if (data) {
            loaded.push({ name: font.name, data })
            console.info(`[Fonts] 已读取字体文件：${font.name}${font.families?.length ? `（${font.families.join(' / ')}）` : ''}`)
          } else {
            console.warn(`[Fonts] 读取字体文件失败：${font.name}`)
          }
        }),
      )
      // Continue even if some fail
      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[Fonts] Failed to load a font:', result.reason)
        }
      }
    }

    return loaded
  })()

  return fontsLoadedPromise
}

export async function getPreferredPresentationFont(): Promise<string | null> {
  const fontList = await fetchSystemFontList()
  return pickPreferredPresentationFont(fontList)
}

export async function uploadFontsToWorker(worker: Worker): Promise<void> {
  const fonts = await loadSystemFonts()
  if (!fonts.length) return

  const requestId = `fonts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const transferable = fonts.map((font) => ({
    name: font.name,
    data: font.data,
  }))

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('message', handleMessage)
      reject(new Error('等待 LibreOffice 字体装载确认超时'))
    }, 15000)

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        id?: string
        type?: string
        success?: boolean
        installedCount?: number
        installedFonts?: string[]
        error?: string
      } | null
      if (!data || data.id !== requestId || data.type !== 'upload-fonts-result') return

      window.clearTimeout(timeout)
      worker.removeEventListener('message', handleMessage)

      if (!data.success) {
        reject(new Error(data.error || 'LibreOffice 字体装载失败'))
        return
      }

      console.info(
        `[Fonts] LibreOffice 已确认装入 ${data.installedCount ?? fonts.length} 个字体文件：${(data.installedFonts ?? []).join(', ') || '未返回文件名'}`,
      )
      resolve()
    }

    worker.addEventListener('message', handleMessage)
    worker.postMessage(
      { type: 'upload-fonts', id: requestId, fonts: transferable },
      fonts.map((f) => f.data),
    )
  })
}
