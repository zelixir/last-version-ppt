import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';
import PptxGenJS from 'pptxgenjs';
import { getImageMediaType } from './project-tool-helpers.ts';

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
const MAX_EMBED_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_FONT_FAMILY = '\'Noto Sans CJK SC\', \'Microsoft YaHei\', \'PingFang SC\', \'Hiragino Sans GB\', Arial, Helvetica, sans-serif';

function toInches(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.abs(value) > 1000 ? value / EMU_PER_INCH : value;
}

function toPixels(value: unknown): number {
  return Math.round(toInches(value) * PX_PER_INCH);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeColor(value: unknown, fallback = '#000000'): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return fallback;
  return `#${color.toUpperCase()}`;
}

function toDataUrl(input: string): string {
  if (!input) return '';
  if (input.startsWith('data:') || input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }
  if (!existsSync(input)) return '';
  if (statSync(input).size > MAX_EMBED_IMAGE_BYTES) return '';
  const buffer = readFileSync(input);
  return `data:${getImageMediaType(input)};base64,${buffer.toString('base64')}`;
}

function textRunsToString(textRuns: any[]): string {
  return textRuns.reduce((result: string, run: any, index: number) => {
    const segment = typeof run?.text === 'string' ? run.text : String(run?.text ?? '');
    const shouldBreak = Boolean(run?.options?.breakLine) && index < textRuns.length - 1;
    return result + segment + (shouldBreak ? '\n' : '');
  }, '');
}

function estimateCharacterWidth(char: string, fontSize: number): number {
  if (!char) return 0;
  if (/\s/.test(char)) return fontSize * 0.32;
  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(char)) return fontSize * 0.98;
  if (/[A-Z0-9]/.test(char)) return fontSize * 0.62;
  if (/[a-z]/.test(char)) return fontSize * 0.54;
  if (/[.,;:!?'"，。；：！？、】【（）()《》“”‘’]/u.test(char)) return fontSize * 0.3;
  return fontSize * 0.56;
}

function wrapParagraph(paragraph: string, maxWidth: number, fontSize: number): string[] {
  if (!paragraph) return [''];
  if (maxWidth <= 0) return [paragraph];

  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;

  for (const char of Array.from(paragraph)) {
    const charWidth = estimateCharacterWidth(char, fontSize);
    if (currentLine && currentWidth + charWidth > maxWidth) {
      lines.push(currentLine.trimEnd());
      currentLine = /\s/.test(char) ? '' : char;
      currentWidth = /\s/.test(char) ? 0 : charWidth;
      continue;
    }
    currentLine += char;
    currentWidth += charWidth;
  }

  if (currentLine || lines.length === 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
}

function wrapTextToLines(text: string, maxWidth: number, fontSize: number): string[] {
  return text
    .split(/\r?\n/)
    .flatMap(paragraph => wrapParagraph(paragraph, maxWidth, fontSize));
}

function renderTextBlock(text: string, x: number, y: number, w: number, h: number, options: any): string {
  const fontSize = Math.max(12, Math.round((typeof options.fontSize === 'number' ? options.fontSize : 36) * (PX_PER_INCH / 72)));
  const paddingX = 12;
  const paddingY = 12;
  const fillColor = options.fill?.color ? normalizeColor(options.fill.color, '') : '';
  const borderColor = options.line?.color ? normalizeColor(options.line.color, '') : '';
  const lines = wrapTextToLines(text, Math.max(0, w - paddingX * 2), fontSize);
  const lineHeight = Math.round(fontSize * 1.35);

  return [
    fillColor ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillColor}" rx="10" ry="10" />` : '',
    borderColor ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${borderColor}" stroke-width="1" rx="10" ry="10" />` : '',
    `<text x="${x + paddingX}" y="${y + paddingY + fontSize}" fill="${normalizeColor(options.color, '#0F172A')}" font-size="${fontSize}" font-family="${DEFAULT_FONT_FAMILY}" font-weight="${options.bold ? '700' : '400'}">`,
    lines.map((line, index) => `<tspan x="${x + paddingX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line || ' ')}</tspan>`).join(''),
    '</text>',
  ].filter(Boolean).join('');
}

function renderShape(item: any): string {
  const options = item?.options ?? {};
  const x = toPixels(options.x);
  const y = toPixels(options.y);
  const w = Math.max(0, toPixels(options.w));
  const h = Math.max(0, toPixels(options.h));
  const fill = normalizeColor(options.fill?.color, 'transparent');
  const stroke = options.line?.color ? normalizeColor(options.line.color, '#CBD5E1') : 'none';
  const strokeWidth = typeof options.line?.pt === 'number' ? Math.max(1, options.line.pt) : 1;

  if ((item?.shape || '').toLowerCase().includes('line')) {
    return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if ((item?.shape || '').toLowerCase().includes('ellipse')) {
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  const rounded = (item?.shape || '').toLowerCase().includes('round');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rounded ? 18 : 0}" ry="${rounded ? 18 : 0}" />`;
}

function renderTable(item: any): string {
  const options = item?.options ?? {};
  const rows: string[][] = Array.isArray(item?.arrTabRows)
    ? item.arrTabRows.map((row: any[]) => row.map(cell => String(cell?.text ?? '')))
    : [];
  if (rows.length === 0) return '';

  const x = toPixels(options.x);
  const y = toPixels(options.y);
  const w = Math.max(0, toPixels(options.w));
  const h = Math.max(0, toPixels(options.h));
  const rowHeight = h / rows.length;
  const colCount = Math.max(...rows.map((row: string[]) => row.length), 1);
  const colWidth = w / colCount;
  const fontSize = Math.max(12, Math.round((typeof options.fontSize === 'number' ? options.fontSize : 32) * (PX_PER_INCH / 72)));

  const cells = rows.flatMap((row: string[], rowIndex: number) => row.map((cell: string, colIndex: number) => {
    const cellX = x + colIndex * colWidth;
    const cellY = y + rowIndex * rowHeight;
    const isHeader = rowIndex === 0;
    return [
      `<rect x="${cellX}" y="${cellY}" width="${colWidth}" height="${rowHeight}" fill="${isHeader ? '#E2E8F0' : '#FFFFFF'}" stroke="#CBD5E1" stroke-width="1" />`,
      `<text x="${cellX + 10}" y="${cellY + fontSize + 8}" fill="#334155" font-size="${fontSize}" font-family="${DEFAULT_FONT_FAMILY}" font-weight="${isHeader ? '700' : '400'}">${escapeXml(cell || ' ')}</text>`,
    ].join('');
  }));

  return cells.join('');
}

export function renderPptPageAsSvg(
  pptx: PptxGenJS,
  pageNumber: number,
): { slideCount: number; svg: string } {
  const slides = Array.isArray((pptx as any)._slides) ? (pptx as any)._slides : [];
  const slideCount = slides.length;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > slideCount) {
    throw new Error(`页码超出范围，当前共有 ${slideCount} 页`);
  }

  const slide = slides[pageNumber - 1];
  const layout = (pptx as any)._presLayout;
  const width = Math.max(1, toPixels(layout?.width) || Math.round(13.333 * PX_PER_INCH));
  const height = Math.max(1, toPixels(layout?.height) || Math.round(7.5 * PX_PER_INCH));
  const background = normalizeColor(slide?._background?.color, '#FFFFFF');
  const relsMedia = Array.isArray(slide?._relsMedia) ? slide._relsMedia : [];
  const objects = Array.isArray(slide?._slideObjects) ? slide._slideObjects : [];

  const body = objects.map((item: any) => {
    if (item?._type === 'image') {
      const media = relsMedia.find((entry: any) => entry?.rId === item.imageRid);
      const href = toDataUrl(media?.data || media?.path || item.image || '');
      if (!href) return '';
      return `<image href="${escapeXml(href)}" x="${toPixels(item.options?.x)}" y="${toPixels(item.options?.y)}" width="${Math.max(0, toPixels(item.options?.w))}" height="${Math.max(0, toPixels(item.options?.h))}" preserveAspectRatio="none" />`;
    }

    if (item?._type === 'table') {
      return renderTable(item);
    }

    const textRuns = Array.isArray(item?.text) ? item.text : [];
    if (textRuns.length > 0) {
      const text = textRunsToString(textRuns);
      const options = item.options ?? textRuns[0]?.options ?? {};
      return renderTextBlock(
        text,
        toPixels(options.x),
        toPixels(options.y),
        Math.max(0, toPixels(options.w)),
        Math.max(0, toPixels(options.h)),
        options,
      );
    }

    return renderShape(item);
  }).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}" />
  ${body}
</svg>`;

  return {
    slideCount,
    svg,
  };
}

export async function renderPptPageAsImage(
  pptx: PptxGenJS,
  pageNumber: number,
): Promise<{ slideCount: number; mediaType: 'image/png'; data: string }> {
  const { slideCount, svg } = renderPptPageAsSvg(pptx, pageNumber);
  const pngData = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  return {
    slideCount,
    mediaType: 'image/png',
    data: Buffer.from(pngData).toString('base64'),
  };
}
