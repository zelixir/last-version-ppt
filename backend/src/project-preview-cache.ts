import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { resolveProjectFile } from './storage.ts';

const PREVIEW_DIR_NAME = 'preview';
const PREVIEW_FILE_PATTERN = /^slide-(\d+)\.png$/i;

export interface ProjectPreviewImageInfo {
  pageNumber: number;
  fileName: string;
  filePath: string;
  updatedAt: string;
}

export function getProjectPreviewDir(projectId: string): string {
  return resolveProjectFile(projectId, PREVIEW_DIR_NAME);
}

export function buildProjectPreviewFileName(pageNumber: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error('页码必须是大于 0 的整数');
  }
  return `slide-${pageNumber}.png`;
}

export function getProjectPreviewFilePath(projectId: string, pageNumber: number): string {
  return resolveProjectFile(projectId, path.posix.join(PREVIEW_DIR_NAME, buildProjectPreviewFileName(pageNumber)));
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
  images: Array<{ pageNumber: number; data: Uint8Array }>,
): ProjectPreviewImageInfo[] {
  const previewDir = getProjectPreviewDir(projectId);
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  for (const image of images) {
    writeFileSync(getProjectPreviewFilePath(projectId, image.pageNumber), image.data);
  }

  return listProjectPreviewImages(projectId);
}

export function readProjectPreviewImage(
  projectId: string,
  pageNumber: number,
): { slideCount: number; mediaType: 'image/png'; data: string } {
  const previews = listProjectPreviewImages(projectId);
  if (previews.length === 0) {
    throw new Error('还没有缓存预览图，请先在页面里刷新预览。');
  }

  const preview = previews.find(item => item.pageNumber === pageNumber);
  if (!preview) {
    throw new Error(`页码超出范围，当前缓存里共有 ${previews.length} 页`);
  }

  return {
    slideCount: previews.length,
    mediaType: 'image/png',
    data: readFileSync(preview.filePath).toString('base64'),
  };
}
