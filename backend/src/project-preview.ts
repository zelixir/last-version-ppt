import type PptxGenJS from 'pptxgenjs';
import { generateProjectPreviewImages } from './project-preview-generator.ts';
import { runProject } from './project-runner.ts';

const EMU_PER_INCH = 914400;
const PROJECT_FILE_API_PREFIX = '/api/projects';
const DEFAULT_PPT_WIDTH = 13.333;
const DEFAULT_PPT_HEIGHT = 7.5;

export interface PreviewTextElement {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  align?: string;
  valign?: string;
  fillColor?: string;
  borderColor?: string;
}

export interface PreviewShapeElement {
  kind: 'shape';
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor?: string;
  borderColor?: string;
  shape?: string;
}

export interface PreviewImageElement {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface PreviewTableElement {
  kind: 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  rows: string[][];
}

export type PreviewElement = PreviewTextElement | PreviewShapeElement | PreviewImageElement | PreviewTableElement;

export interface PreviewSlide {
  id: string;
  backgroundColor?: string;
  elements: PreviewElement[];
}

export interface PreviewPresentation {
  width: number;
  height: number;
  slides: PreviewSlide[];
  logs: string[];
}

export interface ProjectPreviewResult {
  presentation: PreviewPresentation;
  images: string[];
  imageError?: string;
}

const PREVIEW_IMAGE_TIMEOUT_MS = 20_000;

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildProjectResourceUrl(projectId: string, fileName: string) {
  return `${PROJECT_FILE_API_PREFIX}/${encodeURIComponent(projectId)}/files/raw?fileName=${encodeURIComponent(fileName)}`;
}

function toInches(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.abs(value) > 1000 ? value / EMU_PER_INCH : value;
}

function textRunsToString(textRuns: any[]): string {
  return textRuns.reduce((result: string, run: any, index: number) => {
    const segment = typeof run?.text === 'string' ? run.text : String(run?.text ?? '');
    const shouldBreak = Boolean(run?.options?.breakLine) && index < textRuns.length - 1;
    return result + segment + (shouldBreak ? '\n' : '');
  }, '');
}

function normalizePreviewImageSrc(projectId: string, rawSrc: unknown): string {
  if (typeof rawSrc !== 'string') return '';
  const src = rawSrc.trim();
  if (!src) return '';
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith(`${PROJECT_FILE_API_PREFIX}/`)) {
    return src;
  }

  const legacyPrefix = `/${projectId}/`;
  if (src.startsWith(legacyPrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(legacyPrefix.length)));
  }

  const localhostPrefix = `http://localhost:3101/${projectId}/`;
  if (src.startsWith(localhostPrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(localhostPrefix.length)));
  }

  const localhostSecurePrefix = `https://localhost:3101/${projectId}/`;
  if (src.startsWith(localhostSecurePrefix)) {
    return buildProjectResourceUrl(projectId, decodeURIComponent(src.slice(localhostSecurePrefix.length)));
  }

  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  if (/^(\/|[A-Za-z]:[\\/])/.test(src)) {
    const normalizedPath = src.replace(/\\/g, '/');
    const projectPathMarker = `/${projectId}/`;
    const projectPathIndex = normalizedPath.lastIndexOf(projectPathMarker);
    const fileName = projectPathIndex >= 0
      ? normalizedPath.slice(projectPathIndex + projectPathMarker.length)
      : normalizedPath.split('/').filter(Boolean).slice(-1)[0] ?? '';
    return fileName ? buildProjectResourceUrl(projectId, fileName) : '';
  }

  return buildProjectResourceUrl(projectId, src.replace(/^\.\//, ''));
}

function serializeSlide(projectId: string, slide: any): PreviewSlide {
  const relsMedia = Array.isArray(slide?._relsMedia) ? slide._relsMedia : [];
  const elements: PreviewElement[] = (Array.isArray(slide?._slideObjects) ? slide._slideObjects : []).flatMap((item: any, index: number) => {
    if (item?._type === 'image') {
      const media = relsMedia.find((entry: any) => entry?.rId === item.imageRid);
      const src = normalizePreviewImageSrc(projectId, media?.data || media?.path || item.image || '');
      return src
        ? [{ kind: 'image', x: toInches(item.options?.x), y: toInches(item.options?.y), w: toInches(item.options?.w), h: toInches(item.options?.h), src }]
        : [];
    }

    if (item?._type === 'table') {
      const rows = Array.isArray(item.arrTabRows)
        ? item.arrTabRows.map((row: any[]) => row.map(cell => String(cell?.text ?? '')))
        : [];
      return [{
        kind: 'table',
        x: toInches(item.options?.x),
        y: toInches(item.options?.y),
        w: toInches(item.options?.w),
        h: toInches(item.options?.h),
        fontSize: typeof item.options?.fontSize === 'number' ? item.options.fontSize : undefined,
        rows,
      }];
    }

    const textRuns = Array.isArray(item?.text) ? item.text : [];
    if (textRuns.length > 0) {
      const text = textRunsToString(textRuns);
      const options = item.options ?? textRuns[0]?.options ?? {};
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
      }];
    }

    const options = item?.options ?? {};
    return [{
      kind: 'shape',
      x: toInches(options.x),
      y: toInches(options.y),
      w: toInches(options.w),
      h: toInches(options.h),
      fillColor: options.fill?.color,
      borderColor: options.line?.color,
      shape: item?.shape || `shape-${index}`,
    }];
  });

  return {
    id: String(slide?._slideId ?? Math.random()),
    backgroundColor: slide?._background?.color,
    elements,
  };
}

export function buildProjectPreviewPresentation(
  projectId: string,
  pptx: PptxGenJS,
  logs: string[],
  warnings: string[],
): PreviewPresentation {
  const layout = (pptx as any)._presLayout;
  return {
    width: toInches(layout?.width) || DEFAULT_PPT_WIDTH,
    height: toInches(layout?.height) || DEFAULT_PPT_HEIGHT,
    slides: ((pptx as any)._slides ?? []).map((slide: any) => serializeSlide(projectId, slide)),
    logs: warnings.length ? [...logs, ...warnings.map(message => `[警告] ${message}`)] : logs,
  };
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function generateProjectPreview(projectId: string): Promise<ProjectPreviewResult> {
  const result = await runProject({ projectId, includeLogs: true });
  if (!result.ok || !result.pptx) {
    throw new Error(result.error || '预览生成失败');
  }

  const pptxStream = await result.pptx.write({ outputType: 'uint8array' });
  if (!(pptxStream instanceof Uint8Array) && !(pptxStream instanceof ArrayBuffer)) {
    throw new Error('服务器没有生成可用的 PPT 文件内容');
  }
  let images: string[] = [];
  let imageError: string | undefined;
  try {
    const generatedImages = await withTimeout(
      generateProjectPreviewImages(projectId, toUint8Array(pptxStream)),
      PREVIEW_IMAGE_TIMEOUT_MS,
      '服务器生成高保真预览图超时，请稍后再试',
    );
    images = generatedImages.images.map(image => image.url);
  } catch (error) {
    imageError = error instanceof Error ? error.message : String(error);
  }

  return {
    presentation: buildProjectPreviewPresentation(projectId, result.pptx, result.logs, result.warnings),
    images,
    imageError,
  };
}
