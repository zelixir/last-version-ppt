interface SystemFontInfo {
  name: string
  size: number
}

let cachedFontList: SystemFontInfo[] | null = null

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

let fontsLoadedPromise: Promise<Array<{ name: string; data: ArrayBuffer }>> | null = null

export function loadSystemFonts(): Promise<Array<{ name: string; data: ArrayBuffer }>> {
  if (fontsLoadedPromise) return fontsLoadedPromise

  fontsLoadedPromise = (async () => {
    const fontList = await fetchSystemFontList()
    if (!fontList.length) return []

    const loaded: Array<{ name: string; data: ArrayBuffer }> = []

    // Load fonts in parallel batches to avoid overwhelming the server
    const BATCH_SIZE = 4
    for (let i = 0; i < fontList.length; i += BATCH_SIZE) {
      const batch = fontList.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (font) => {
          const data = await fetchSystemFontData(font.name)
          if (data) loaded.push({ name: font.name, data })
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
