import PptxGenJS from 'pptxgenjs'
import type { PreviewElement, PreviewPresentation, PreviewSlide } from '../types'

export interface ProjectPreviewRunResult {
  presentation: PreviewPresentation
  pptxData: Uint8Array
}

const EMU_PER_INCH = 914400
const PROJECT_FILE_API_PREFIX = '/api/projects'
export const DEFAULT_PPT_LAYOUT = 'LAYOUT_WIDE'
export const DEFAULT_PPT_WIDTH = 13.333
export const DEFAULT_PPT_HEIGHT = 7.5
const PPT_TEXT_PIXELS_PER_INCH = 96
const PPT_POINTS_PER_INCH = 72
const PPT_TEXT_SAFE_WIDTH_RATIO = 0.96
const PPT_TEXT_LINE_HEIGHT_FACTOR = 1.67
const PPT_TEXT_SAFE_HEIGHT_PADDING = 0.02
const PPT_POINT_TO_PIXEL_RATIO = PPT_TEXT_PIXELS_PER_INCH / PPT_POINTS_PER_INCH
// The bundled UI subset font is intentionally excluded here because it does not
// cover every demo string used in PPT templates, which can skew canvas metrics.
const DEFAULT_MEASURE_TEXT_FALLBACK_FONTS = [
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'sans-serif',
]

let textMeasureCanvas: HTMLCanvasElement | null = null

function roundUpToHundredth(value: number): number {
  return Math.ceil(value * 100) / 100
}

function calculateSafeSingleLineWidthPx(width: number): number {
  return Math.floor(width * PPT_TEXT_PIXELS_PER_INCH * PPT_TEXT_SAFE_WIDTH_RATIO)
}

function buildCanvasFontStack(fontFace: string): string {
  const fontNames = [fontFace, ...DEFAULT_MEASURE_TEXT_FALLBACK_FONTS]
    .filter(Boolean)
    .filter((font, index, list) => list.indexOf(font) === index)
    .map(font => `"${font}"`)
  return fontNames.join(', ')
}

function getTextMeasureContext(): CanvasRenderingContext2D {
  if (!textMeasureCanvas) {
    textMeasureCanvas = document.createElement('canvas')
  }
  const context = textMeasureCanvas.getContext('2d')
  if (!context) {
    throw new Error('当前浏览器无法创建文字测量画布，请稍后再试')
  }
  return context
}

function measureRenderedTextWidth(context: CanvasRenderingContext2D, text: string): number {
  const metrics = context.measureText(text)
  const actualBoundingWidth = Math.abs(metrics.actualBoundingBoxLeft || 0) + Math.abs(metrics.actualBoundingBoxRight || 0)
  return Math.max(metrics.width, actualBoundingWidth)
}

function splitMeasuredLines(context: CanvasRenderingContext2D, text: string, maxWidthPx?: number): Array<{ text: string; width: number }> {
  const paragraphs = text.split(/\r?\n/u)
  return paragraphs.flatMap(paragraph => {
    if (!paragraph) return [{ text: '', width: 0 }]
    if (!Number.isFinite(maxWidthPx) || !maxWidthPx || maxWidthPx <= 0) {
      return [{ text: paragraph, width: measureRenderedTextWidth(context, paragraph) }]
    }

    const lines: Array<{ text: string; width: number }> = []
    let currentText = ''
    let currentWidth = 0

    for (const character of Array.from(paragraph)) {
      const nextText = currentText + character
      const nextWidth = measureRenderedTextWidth(context, nextText)
      if (currentText && nextWidth > maxWidthPx) {
        lines.push({ text: currentText, width: currentWidth })
        currentText = character
        currentWidth = measureRenderedTextWidth(context, character)
        continue
      }
      currentText = nextText
      currentWidth = nextWidth
    }

    lines.push({ text: currentText, width: currentWidth })
    return lines
  })
}

function buildProjectResourceUrl(projectId: string, fileName: string) {
  return `${PROJECT_FILE_API_PREFIX}/${encodeURIComponent(projectId)}/files/raw?fileName=${encodeURIComponent(fileName)}`
}

function toInches(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.abs(value) > 1000 ? value / EMU_PER_INCH : value
}

function findBuildFunction(moduleExports: unknown): ((context: any) => Promise<unknown> | unknown) | null {
  if (typeof moduleExports === 'function') return moduleExports as (context: any) => Promise<unknown> | unknown
  if (moduleExports && typeof moduleExports === 'object') {
    const maybeDefault = (moduleExports as Record<string, unknown>).default
    const maybeBuild = (moduleExports as Record<string, unknown>).buildPresentation
    if (typeof maybeDefault === 'function') return maybeDefault as (context: any) => Promise<unknown> | unknown
    if (typeof maybeBuild === 'function') return maybeBuild as (context: any) => Promise<unknown> | unknown
  }
  return null
}

function normalizePreviewImageSrc(projectId: string, rawSrc: unknown): string {
  if (typeof rawSrc !== 'string') return ''
  const src = rawSrc.trim()
  if (!src) return ''
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith(`${PROJECT_FILE_API_PREFIX}/`)) {
    return src
  }

  const legacyPrefix = `/${projectId}/`
  if (src.startsWith(legacyPrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(legacyPrefix.length)))
  }

  const localhostPrefix = `http://localhost:3101/${projectId}/`
  if (src.startsWith(localhostPrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(localhostPrefix.length)))
  }

  const localhostSecurePrefix = `https://localhost:3101/${projectId}/`
  if (src.startsWith(localhostSecurePrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(localhostSecurePrefix.length)))
  }

  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }

  if (/^(\/|[A-Za-z]:[\\/])/.test(src)) {
    const normalizedPath = src.replace(/\\/g, '/')
    const projectPathMarker = `/${projectId}/`
    const projectPathIndex = normalizedPath.lastIndexOf(projectPathMarker)
    const fileName = projectPathIndex >= 0
      ? normalizedPath.slice(projectPathIndex + projectPathMarker.length)
      : normalizedPath.split('/').filter(Boolean).slice(-1)[0] ?? ''
    return fileName ? buildProjectResourceUrl(projectId, fileName) : ''
  }

  return buildProjectResourceUrl(projectId, src.replace(/^\.\//, ''))
}

function textRunsToString(textRuns: any[]): string {
  return textRuns.reduce((result: string, run: any, index: number) => {
    const segment = typeof run?.text === 'string' ? run.text : String(run?.text ?? '')
    const shouldBreak = Boolean(run?.options?.breakLine) && index < textRuns.length - 1
    return result + segment + (shouldBreak ? '\n' : '')
  }, '')
}

function serializeSlide(projectId: string, slide: any): PreviewSlide {
  const relsMedia = Array.isArray(slide?._relsMedia) ? slide._relsMedia : []
  const elements: PreviewElement[] = (Array.isArray(slide?._slideObjects) ? slide._slideObjects : []).flatMap((item: any, index: number) => {
    if (item?._type === 'image') {
      const media = relsMedia.find((entry: any) => entry?.rId === item.imageRid)
      const src = normalizePreviewImageSrc(projectId, media?.data || media?.path || item.image || '')
      return src
        ? [{ kind: 'image', x: toInches(item.options?.x), y: toInches(item.options?.y), w: toInches(item.options?.w), h: toInches(item.options?.h), src }]
        : []
    }

    if (item?._type === 'table') {
      const rows = Array.isArray(item.arrTabRows)
        ? item.arrTabRows.map((row: any[]) => row.map(cell => String(cell?.text ?? '')))
        : []
      return [{
        kind: 'table',
        x: toInches(item.options?.x),
        y: toInches(item.options?.y),
        w: toInches(item.options?.w),
        h: toInches(item.options?.h),
        fontSize: typeof item.options?.fontSize === 'number' ? item.options.fontSize : undefined,
        rows,
      }]
    }

    const textRuns = Array.isArray(item?.text) ? item.text : []
    if (textRuns.length > 0) {
      const text = textRunsToString(textRuns)
      const options = item.options ?? textRuns[0]?.options ?? {}
      return [{
        kind: 'text',
        x: toInches(options.x),
        y: toInches(options.y),
        w: toInches(options.w),
        h: toInches(options.h),
        text,
        color: options.color,
        fontSize: typeof options.fontSize === 'number' ? options.fontSize : undefined,
        bold: Boolean(options.bold),
        align: options.align,
        valign: options.valign || options._bodyProp?.anchor,
        fillColor: options.fill?.color,
        borderColor: options.line?.color,
      }]
    }

    const options = item?.options ?? {}
    return [{
      kind: 'shape',
      x: toInches(options.x),
      y: toInches(options.y),
      w: toInches(options.w),
      h: toInches(options.h),
      fillColor: options.fill?.color,
      borderColor: options.line?.color,
      shape: item?.shape || `shape-${index}`,
    }]
  })

  return {
    id: String(slide?._slideId ?? Math.random()),
    backgroundColor: slide?._background?.color,
    elements,
  }
}

export async function runProjectPreview(projectId: string, code: string): Promise<ProjectPreviewRunResult> {
  const logs: string[] = []
  const module = { exports: {} as any }

  try {
    const evaluator = new Function('module', 'exports', code)
    evaluator(module, module.exports)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }

  const build = findBuildFunction(module.exports)
  if (!build) {
    throw new Error('index.js 必须导出一个函数，例如 module.exports = async function ({ pptx }) { ... }')
  }

  const pptx = new PptxGenJS()
  pptx.layout = DEFAULT_PPT_LAYOUT

  const measureText = async (
    text: string,
    options: { fontSize: number; fontFace: string; width?: number; padding?: number },
  ) => {
    const fontFace = typeof options?.fontFace === 'string' ? options.fontFace.trim() : ''
    if (!fontFace) {
      throw new Error('measureText 需要传入真实字体名，例如 Noto Sans CJK SC')
    }

    const fontSize = typeof options?.fontSize === 'number' ? options.fontSize : 0
    const fontSizePx = fontSize * PPT_POINT_TO_PIXEL_RATIO
    const width = typeof options?.width === 'number' ? options.width : undefined
    const padding = typeof options?.padding === 'number' ? options.padding : PPT_TEXT_SAFE_HEIGHT_PADDING

    const context = getTextMeasureContext()
    const fontStack = buildCanvasFontStack(fontFace)
    await document.fonts.load(`${fontSizePx}px ${fontStack}`)
    await document.fonts.ready
    context.font = `${fontSizePx}px ${fontStack}`

    const lines = splitMeasuredLines(context, text, width ? calculateSafeSingleLineWidthPx(width) : undefined)
    const maxWidthPx = lines.reduce((max, line) => Math.max(max, line.width), 0)
    const lineCount = Math.max(1, lines.length)
    const height = roundUpToHundredth((fontSize * PPT_TEXT_LINE_HEIGHT_FACTOR * lineCount) / 100)
    return {
      width: maxWidthPx,
      widthInches: roundUpToHundredth(maxWidthPx / PPT_TEXT_PIXELS_PER_INCH),
      height,
      safeHeight: roundUpToHundredth(height + padding),
      lineHeight: roundUpToHundredth((fontSize * PPT_TEXT_LINE_HEIGHT_FACTOR) / 100),
      lines: lineCount,
    }
  }

  const context = {
    pptx,
    pptxgenjs: PptxGenJS,
    getResourceUrl: (fileName: string) => buildProjectResourceUrl(projectId, fileName),
    log: (...args: unknown[]) => logs.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')),
    measureText,
  }

  const output = await build(context)
  const finalPptx = output instanceof PptxGenJS ? output : pptx
  const layout = (finalPptx as any)._presLayout
  const pptxStream = await finalPptx.write({ outputType: 'uint8array' })
  if (!(pptxStream instanceof Uint8Array) && !(pptxStream instanceof ArrayBuffer)) {
    throw new Error('浏览器里没有拿到可用的 PPT 文件内容，请稍后再试')
  }
  const pptxData = pptxStream instanceof Uint8Array ? pptxStream : new Uint8Array(pptxStream)

  return {
    presentation: {
      width: toInches(layout?.width) || DEFAULT_PPT_WIDTH,
      height: toInches(layout?.height) || DEFAULT_PPT_HEIGHT,
      slides: ((finalPptx as any)._slides ?? []).map((slide: any) => serializeSlide(projectId, slide)),
      logs,
    },
    pptxData,
  }
}
