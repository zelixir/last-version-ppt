import type { CSSProperties } from 'react'
import type { PreviewPresentation, PreviewSlide } from '../types'

const DEFAULT_PREVIEW_FONT_STACK = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  '"WenQuanYi Micro Hei"',
  'sans-serif',
].join(', ')

function toSlideHeightUnit(value: number, presentation: PreviewPresentation) {
  return `${(value / presentation.height) * 100}cqh`
}

function toSlideWidthUnit(value: number, presentation: PreviewPresentation) {
  return `${(value / presentation.width) * 100}cqw`
}

function toPreviewFontSize(fontSize: number, presentation: PreviewPresentation) {
  return toSlideHeightUnit(fontSize / 72, presentation)
}

function buildPreviewFontFamily(fontFace?: string) {
  const preferredFont = typeof fontFace === 'string' ? fontFace.trim() : ''
  if (!preferredFont) return DEFAULT_PREVIEW_FONT_STACK
  const safeFont = preferredFont
    .replace(/[\u0000-\u001F\u007F\\]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safeFont) return DEFAULT_PREVIEW_FONT_STACK
  return `"${safeFont}", ${DEFAULT_PREVIEW_FONT_STACK}`
}

export default function SlideCanvas({ slide, presentation, compact = false }: { slide: PreviewSlide; presentation: PreviewPresentation; compact?: boolean }) {
  return (
    <div
      data-slide-canvas="true"
      className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-white shadow-lg"
      style={{ aspectRatio: `${presentation.width}/${presentation.height}`, containerType: 'size' }}
    >
      <div className="absolute inset-0" style={{ background: slide.backgroundColor ? `#${slide.backgroundColor}` : '#ffffff' }} />
      {slide.elements.map((element, index) => {
        const style = {
          left: `${(element.x / presentation.width) * 100}%`,
          top: `${(element.y / presentation.height) * 100}%`,
          width: `${(element.w / presentation.width) * 100}%`,
          height: `${(element.h / presentation.height) * 100}%`,
        }

        if (element.kind === 'text') {
          const effectiveFontSize = element.fontSize ?? 28
          return (
            <div
              key={index}
              className="absolute overflow-hidden rounded-sm text-slate-900"
              style={{
                ...style,
                color: element.color ? `#${element.color}` : '#0f172a',
                background: element.fillColor ? `#${element.fillColor}` : 'transparent',
                border: element.borderColor ? `1px solid #${element.borderColor}` : undefined,
                fontWeight: element.bold ? 700 : 400,
                fontFamily: buildPreviewFontFamily(element.fontFace),
                fontSize: toPreviewFontSize(effectiveFontSize, presentation),
                lineHeight: 1.25,
                padding: `${toSlideHeightUnit(compact ? 0.03 : 0.05, presentation)} ${toSlideWidthUnit(compact ? 0.03 : 0.05, presentation)}`,
                textAlign: (element.align as CSSProperties['textAlign']) || 'left',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span className="line-clamp-6 whitespace-pre-wrap">{element.text}</span>
            </div>
          )
        }

        if (element.kind === 'shape') {
          return (
            <div
              key={index}
              className="absolute rounded-sm"
              style={{
                ...style,
                background: element.fillColor ? `#${element.fillColor}` : 'transparent',
                border: element.borderColor ? `1px solid #${element.borderColor}` : '1px solid rgba(15,23,42,0.15)',
              }}
            />
          )
        }

        if (element.kind === 'image') {
          return <img key={index} src={element.src} alt="" aria-hidden="true" className="absolute rounded-sm object-cover" style={style} />
        }

        const tableFontSize = toPreviewFontSize(element.fontSize ?? 32, presentation)
        return (
          <div key={index} className="absolute overflow-hidden rounded border border-slate-300 bg-white" style={style}>
            <table className="h-full w-full text-slate-700" style={{ fontFamily: buildPreviewFontFamily(element.fontFace), fontSize: tableFontSize, lineHeight: 1.2 }}>
              <tbody>
                {element.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="border border-slate-200 align-top"
                        style={{ padding: `${toSlideHeightUnit(compact ? 0.02 : 0.04, presentation)} ${toSlideWidthUnit(compact ? 0.02 : 0.04, presentation)}` }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
