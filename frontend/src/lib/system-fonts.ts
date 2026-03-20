interface SystemFontInfo {
  name: string
  size: number
}

interface FontTestConfig {
  skipBundledFonts?: boolean
  onlyFontNames?: string[]
}

declare global {
  interface Window {
    __LAST_VERSION_PPT_FONT_TEST__?: FontTestConfig
  }
}

const bundledFonts: Array<{ name: string; url: string }> = []
const PREFERRED_SYSTEM_FONT_PATTERNS = [
  /NotoSansCJK/i,
  /NotoSerifCJK/i,
  /SourceHan/i,
  /Microsoft-YaHei|Microsoft YaHei|msyh/i,
  /SimHei|SimSun|NSimSun/i,
  /PingFang|Heiti/i,
  /WenQuanYi/i,
  /Sarasa/i,
  /DroidSansFallback/i,
  /ArialUnicode|Arial Unicode/i,
  /DejaVuSans/i,
]
// Keeping this list small avoids spending seconds uploading large font collections
// into the worker while still covering common CJK fonts and one lightweight general fallback.
const MAX_SYSTEM_FONTS_TO_LOAD = 8

let cachedFontList: SystemFontInfo[] | null = null

function readFontTestConfig(): FontTestConfig | null {
  if (typeof window === 'undefined') return null
  return window.__LAST_VERSION_PPT_FONT_TEST__ ?? null
}

export async function fetchSystemFontList(): Promise<SystemFontInfo[]> {
  if (cachedFontList) return cachedFontList

  try {
    const response = await fetch('/api/system-fonts')
    if (!response.ok) return []
    const data = (await response.json()) as { fonts: SystemFontInfo[] }
    cachedFontList = data.fonts ?? []
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

async function fetchBundledFontData(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.arrayBuffer()
  } catch {
    return null
  }
}

function pickSystemFonts(fontList: SystemFontInfo[]) {
  const ranked = fontList
    .map(font => ({
      font,
      priority: PREFERRED_SYSTEM_FONT_PATTERNS.findIndex(pattern => pattern.test(font.name)),
    }))
    .filter(entry => entry.priority >= 0)
    .sort((a, b) => a.priority - b.priority || a.font.name.localeCompare(b.font.name))
    .map(entry => entry.font)

  if (ranked.length > 0) {
    return ranked.slice(0, MAX_SYSTEM_FONTS_TO_LOAD)
  }

  return fontList.slice(0, MAX_SYSTEM_FONTS_TO_LOAD)
}

let fontsLoadedPromise: Promise<Array<{ name: string; data: ArrayBuffer }>> | null = null

export function loadSystemFonts(): Promise<Array<{ name: string; data: ArrayBuffer }>> {
  if (fontsLoadedPromise) return fontsLoadedPromise

  fontsLoadedPromise = (async () => {
    const loaded: Array<{ name: string; data: ArrayBuffer }> = []
    const seenNames = new Set<string>()
    const fontTestConfig = readFontTestConfig()
    const allowedFontNames = fontTestConfig?.onlyFontNames?.filter(Boolean) ?? []

    if (!fontTestConfig?.skipBundledFonts) {
      for (const font of bundledFonts) {
        const data = await fetchBundledFontData(font.url)
        if (!data) continue
        loaded.push({ name: font.name, data })
        seenNames.add(font.name)
      }
    }

    const fontList = pickSystemFonts(await fetchSystemFontList())
      .filter(font => allowedFontNames.length === 0 || allowedFontNames.includes(font.name))
    if (!fontList.length) return loaded

    // Load fonts in parallel batches to avoid overwhelming the server
    const BATCH_SIZE = 4
    for (let i = 0; i < fontList.length; i += BATCH_SIZE) {
      const batch = fontList.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (font) => {
          if (seenNames.has(font.name)) return
          const data = await fetchSystemFontData(font.name)
          if (!data) return
          loaded.push({ name: font.name, data })
          seenNames.add(font.name)
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

export async function uploadFontsToWorker(worker: Worker): Promise<void> {
  const fonts = await loadSystemFonts()
  if (!fonts.length) return

  const transferable = fonts.map((font) => ({
    name: font.name,
    data: font.data,
  }))

  worker.postMessage(
    { type: 'upload-fonts', id: `fonts-${Date.now()}`, fonts: transferable },
    fonts.map((f) => f.data),
  )
}
