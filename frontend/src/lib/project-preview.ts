import PptxGenJS from 'pptxgenjs'
import type { PreviewElement, PreviewPresentation, PreviewSlide } from '../types'

export interface ProjectPreviewRunResult {
  presentation: PreviewPresentation
  pptxData: Uint8Array
}

const EMU_PER_INCH = 914400
const PROJECT_FILE_API_PREFIX = '/api/projects'

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
        fontFace: typeof item.options?.fontFace === 'string' ? item.options.fontFace : undefined,
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
        fontFace: typeof options.fontFace === 'string' ? options.fontFace : undefined,
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
  pptx.layout = 'LAYOUT_WIDE'

  const context = {
    pptx,
    pptxgenjs: PptxGenJS,
    getResourceUrl: (fileName: string) => buildProjectResourceUrl(projectId, fileName),
    log: (...args: unknown[]) => logs.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')),
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
      width: toInches(layout?.width) || 13.333,
      height: toInches(layout?.height) || 7.5,
      slides: ((finalPptx as any)._slides ?? []).map((slide: any) => serializeSlide(projectId, slide)),
      logs,
    },
    pptxData,
  }
}
