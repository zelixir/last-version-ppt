import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { getProjectDir } from './storage.ts';
import { renderPptPageAsImage as renderSlidePreviewImage } from './slide-render.ts';

const EMU_PER_INCH = 914400;
const PREVIEW_DIRECTORY = 'preview';

function toInches(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  // PptxGenJS 里版式尺寸通常是英寸，小图元坐标有时会是 EMU；超过 1000 时按 EMU 处理即可覆盖这两类输入。
  return Math.abs(value) > 1000 ? value / EMU_PER_INCH : value;
}

export function getPptPreviewSize(pptx: PptxGenJS): { width: number; height: number } {
  const layout = (pptx as any)._presLayout;
  return {
    width: toInches(layout?.width) || 13.333,
    height: toInches(layout?.height) || 7.5,
  };
}

export async function renderPptPageAsImage(
  pptx: PptxGenJS,
  pageNumber: number,
): Promise<{ slideCount: number; mediaType: 'image/png'; data: string }> {
  return renderSlidePreviewImage(pptx, pageNumber);
}

export interface ProjectPreviewResult {
  width: number;
  height: number;
  slideCount: number;
  files: string[];
}

export async function generateProjectPreviewImages(projectId: string, pptx: PptxGenJS): Promise<ProjectPreviewResult> {
  const previewDir = path.join(getProjectDir(projectId), PREVIEW_DIRECTORY);
  mkdirSync(previewDir, { recursive: true });
  for (const entry of readdirSync(previewDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^slide-\d+\.png$/i.test(entry.name)) continue;
    rmSync(path.join(previewDir, entry.name), { force: true });
  }

  const slides = Array.isArray((pptx as any)._slides) ? (pptx as any)._slides : [];
  const files: string[] = [];
  for (let pageNumber = 1; pageNumber <= slides.length; pageNumber += 1) {
    const rendered = await renderSlidePreviewImage(pptx, pageNumber);
    const fileName = `${PREVIEW_DIRECTORY}/slide-${pageNumber}.png`;
    writeFileSync(path.join(getProjectDir(projectId), fileName), Buffer.from(rendered.data, 'base64'));
    files.push(fileName);
  }

  return {
    ...getPptPreviewSize(pptx),
    slideCount: slides.length,
    files,
  };
}
