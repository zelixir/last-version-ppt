import type { PreviewImageElement, PreviewPresentation, PreviewShapeElement, PreviewSlide, PreviewTableElement, PreviewTextElement } from '../types'

const PX_PER_INCH = 96
const DEFAULT_FONT_FAMILY = '\'Noto Sans CJK SC\', \'Microsoft YaHei\', \'PingFang SC\', \'Hiragino Sans GB\', Arial, Helvetica, sans-serif'
const DEFAULT_TEXT_FONT_SIZE_PT = 28
const DEFAULT_TABLE_FONT_SIZE_PT = 32
const CHAR_WIDTH_FACTORS = {
  whitespace: 0.32,
  cjk: 0.98,
  uppercaseOrDigit: 0.62,
  lowercase: 0.54,
  punctuation: 0.3,
  fallback: 0.56,
} as const

export interface PreviewSvgImageAsset {
  href: string
  src: string
}

export interface PreviewSvgResult {
  width: number
  height: number
  svg: string
  imageAssets: PreviewSvgImageAsset[]
}

function toPixels(value: number) {
  return Math.round(value * PX_PER_INCH)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeColor(value: string | undefined, fallback = '#000000') {
  if (typeof value !== 'string') return fallback
  const color = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return fallback
  return `#${color.toUpperCase()}`
}

function estimateCharacterWidth(char: string, fontSize: number) {
  if (!char) return 0
  if (/\s/.test(char)) return fontSize * CHAR_WIDTH_FACTORS.whitespace
  if (CJK_CHAR_PATTERN.test(char)) return fontSize * CHAR_WIDTH_FACTORS.cjk
  if (/[A-Z0-9]/.test(char)) return fontSize * CHAR_WIDTH_FACTORS.uppercaseOrDigit
  if (/[a-z]/.test(char)) return fontSize * CHAR_WIDTH_FACTORS.lowercase
  if (/[.,;:!?'"，。；：！？、】【（）()《》“”‘’]/u.test(char)) return fontSize * CHAR_WIDTH_FACTORS.punctuation
  return fontSize * CHAR_WIDTH_FACTORS.fallback
}

function wrapParagraph(paragraph: string, maxWidth: number, fontSize: number): string[] {
  if (!paragraph) return ['']
  if (maxWidth <= 0) return [paragraph]

  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0

  for (const char of Array.from(paragraph)) {
    const charWidth = estimateCharacterWidth(char, fontSize)
    if (currentLine && currentWidth + charWidth > maxWidth) {
      lines.push(currentLine.trimEnd())
      currentLine = /\s/.test(char) ? '' : char
      currentWidth = /\s/.test(char) ? 0 : charWidth
      continue
    }
    currentLine += char
    currentWidth += charWidth
  }

  if (currentLine || lines.length === 0) {
    lines.push(currentLine.trimEnd())
  }

  return lines
}

function wrapTextToLines(text: string, maxWidth: number, fontSize: number) {
  return text
    .split(/\r?\n/)
    .flatMap(paragraph => wrapParagraph(paragraph, maxWidth, fontSize))
}

function renderTextBlock(element: PreviewTextElement) {
  const x = toPixels(element.x)
  const y = toPixels(element.y)
  const w = Math.max(0, toPixels(element.w))
  const h = Math.max(0, toPixels(element.h))
  const fontSize = Math.max(12, Math.round((element.fontSize ?? DEFAULT_TEXT_FONT_SIZE_PT) * (PX_PER_INCH / 72)))
  const paddingX = 12
  const paddingY = 12
  const lines = wrapTextToLines(element.text, Math.max(0, w - paddingX * 2), fontSize)
  const lineHeight = Math.round(fontSize * 1.28)
  const textAlign = element.align === 'center' ? 'center' : element.align === 'right' ? 'right' : 'left'
  const anchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start'
  const textX = textAlign === 'center'
    ? x + w / 2
    : textAlign === 'right'
      ? x + w - paddingX
      : x + paddingX

  const contentHeight = Math.max(fontSize, fontSize + (lines.length - 1) * lineHeight)
  const valign = (element.valign || '').toLowerCase()
  const startY = valign === 'mid' || valign === 'middle' || valign === 'center'
    ? y + Math.max(paddingY + fontSize, (h - contentHeight) / 2 + fontSize)
    : valign === 'bottom'
      ? y + Math.max(fontSize + paddingY, h - contentHeight + fontSize - paddingY)
      : y + paddingY + fontSize

  return [
    element.fillColor ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${normalizeColor(element.fillColor, 'transparent')}" rx="8" ry="8" />` : '',
    element.borderColor ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${normalizeColor(element.borderColor, '#CBD5E1')}" stroke-width="1" rx="8" ry="8" />` : '',
    `<text x="${textX}" y="${startY}" fill="${normalizeColor(element.color, '#0F172A')}" font-size="${fontSize}" font-family="${DEFAULT_FONT_FAMILY}" font-weight="${element.bold ? '700' : '400'}" text-anchor="${anchor}">`,
    lines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line || ' ')}</tspan>`).join(''),
    '</text>',
  ].filter(Boolean).join('')
}

function renderShape(element: PreviewShapeElement) {
  const x = toPixels(element.x)
  const y = toPixels(element.y)
  const w = Math.max(0, toPixels(element.w))
  const h = Math.max(0, toPixels(element.h))
  const shape = (element.shape || '').toLowerCase()
  const fill = element.fillColor ? normalizeColor(element.fillColor, 'transparent') : 'transparent'
  const stroke = element.borderColor ? normalizeColor(element.borderColor, '#CBD5E1') : 'rgba(15,23,42,0.15)'

  if (shape.includes('line')) {
    return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="2" />`
  }
  if (shape.includes('ellipse') || shape.includes('oval') || shape.includes('circle')) {
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1" />`
  }
  const rounded = shape.includes('round')
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1" rx="${rounded ? 18 : 0}" ry="${rounded ? 18 : 0}" />`
}

function renderTable(element: PreviewTableElement) {
  const x = toPixels(element.x)
  const y = toPixels(element.y)
  const w = Math.max(0, toPixels(element.w))
  const h = Math.max(0, toPixels(element.h))
  const rows = Array.isArray(element.rows) ? element.rows : []
  if (rows.length === 0) return ''

  const rowHeight = h / rows.length
  const colCount = Math.max(...rows.map(row => row.length), 1)
  const colWidth = w / colCount
  const fontSize = Math.max(12, Math.round((element.fontSize ?? DEFAULT_TABLE_FONT_SIZE_PT) * (PX_PER_INCH / 72)))

  return rows.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
    const cellX = x + colIndex * colWidth
    const cellY = y + rowIndex * rowHeight
    const isHeader = rowIndex === 0
    return [
      `<rect x="${cellX}" y="${cellY}" width="${colWidth}" height="${rowHeight}" fill="${isHeader ? '#E2E8F0' : '#FFFFFF'}" stroke="#CBD5E1" stroke-width="1" />`,
      `<text x="${cellX + 10}" y="${cellY + fontSize + 8}" fill="#334155" font-size="${fontSize}" font-family="${DEFAULT_FONT_FAMILY}" font-weight="${isHeader ? '700' : '400'}">${escapeXml(cell || ' ')}</text>`,
    ].join('')
  })).join('')
}

function renderImage(element: PreviewImageElement, index: number, imageAssets: PreviewSvgImageAsset[]) {
  const href = `preview-image-${index}`
  imageAssets.push({ href, src: element.src })
  return `<image href="${href}" x="${toPixels(element.x)}" y="${toPixels(element.y)}" width="${Math.max(0, toPixels(element.w))}" height="${Math.max(0, toPixels(element.h))}" preserveAspectRatio="none" />`
}

export function buildPreviewSlideSvg(presentation: PreviewPresentation, slide: PreviewSlide): PreviewSvgResult {
  const width = Math.max(1, toPixels(presentation.width))
  const height = Math.max(1, toPixels(presentation.height))
  const imageAssets: PreviewSvgImageAsset[] = []

  const body = slide.elements.map((element, index) => {
    if (element.kind === 'text') return renderTextBlock(element)
    if (element.kind === 'shape') return renderShape(element)
    if (element.kind === 'table') return renderTable(element)
    return renderImage(element, index, imageAssets)
  }).join('')

  return {
    width,
    height,
    imageAssets,
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${normalizeColor(slide.backgroundColor, '#FFFFFF')}" />
  ${body}
</svg>`,
  }
}
const CJK_CHAR_PATTERN = /[\p{Unified_Ideograph}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
