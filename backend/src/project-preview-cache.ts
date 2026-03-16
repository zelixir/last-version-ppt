import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { resolveProjectFile } from './storage.ts';

const PREVIEW_DIR_NAME = 'preview';
const PREVIEW_FILE_PATTERN = /^slide-(\d+)\.(png|svg)$/i;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG_HEADER_SCAN_BYTES = 256;
const SVG_PREFIX = '<?xml';
const SVG_TAG_MARKER = '<svg';

function detectPreviewImageFormat(data: Uint8Array): 'png' | 'svg' | null {
  if (data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    return 'png';
  }
  const content = Buffer.from(data).toString('utf8', 0, Math.min(data.length, SVG_HEADER_SCAN_BYTES)).trimStart();
  if (content.startsWith(SVG_PREFIX) || content.indexOf(SVG_TAG_MARKER) !== -1) {
    return 'svg';
  }
  return null;
}

export interface ProjectPreviewImageInfo {
  pageNumber: number;
  fileName: string;
  filePath: string;
  updatedAt: string;
}

export function getProjectPreviewDir(projectId: string): string {
  return resolveProjectFile(projectId, PREVIEW_DIR_NAME);
}

export function buildProjectPreviewFileName(pageNumber: number, extension: 'png' | 'svg' = 'png'): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error('页码必须是大于 0 的整数');
  }
  return `slide-${pageNumber}.${extension}`;
}

export function getProjectPreviewFilePath(projectId: string, pageNumber: number, extension: 'png' | 'svg' = 'png'): string {
  return resolveProjectFile(projectId, path.posix.join(PREVIEW_DIR_NAME, buildProjectPreviewFileName(pageNumber, extension)));
}

export function listProjectPreviewImages(projectId: string): ProjectPreviewImageInfo[] {
  const previewDir = getProjectPreviewDir(projectId);
  if (!existsSync(previewDir)) return [];

  return readdirSync(previewDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .flatMap(entry => {
      const match = entry.name.match(PREVIEW_FILE_PATTERN);
      if (!match) return [];
      const filePath = path.join(previewDir, entry.name);
      const stats = statSync(filePath);
      return [{
        pageNumber: Number(match[1]),
        fileName: entry.name,
        filePath,
        updatedAt: stats.mtime.toISOString(),
      }];
    })
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export function replaceProjectPreviewImages(
  projectId: string,
  images: Array<{ pageNumber: number; extension: 'png' | 'svg'; data: Uint8Array }>,
): ProjectPreviewImageInfo[] {
  const previewDir = getProjectPreviewDir(projectId);
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  for (const image of images) {
    const detectedFormat = detectPreviewImageFormat(image.data);
    if (detectedFormat !== image.extension) {
      throw new Error(`第 ${image.pageNumber} 页预览图格式和文件后缀不一致`);
    }
    writeFileSync(getProjectPreviewFilePath(projectId, image.pageNumber, image.extension), image.data);
  }

  return listProjectPreviewImages(projectId);
}

export function readProjectPreviewImage(
  projectId: string,
  pageNumber: number,
): { slideCount: number; mediaType: 'image/png' | 'image/svg+xml'; data: string } {
  const previews = listProjectPreviewImages(projectId);
  if (previews.length === 0) {
    throw new Error('项目预览缓存还是空的，请先在页面里重新生成预览。');
  }

  const preview = previews.find(item => item.pageNumber === pageNumber);
  if (!preview) {
    throw new Error(`页码超出范围，当前缓存里共有 ${previews.length} 页`);
  }

  return {
    slideCount: previews.length,
    mediaType: preview.fileName.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png',
    data: readFileSync(preview.filePath).toString('base64'),
  };
}
