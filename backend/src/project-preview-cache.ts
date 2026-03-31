import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import type { PreviewPresentation } from './project-preview.ts';
import { getProjectDir, resolveProjectFile } from './storage.ts';

const PREVIEW_DIR_NAME = 'preview';
const PREVIEW_FILE_PATTERN = /^slide-(\d+)\.png$/i;
const PREVIEW_METADATA_FILE = 'meta.json';

export interface ProjectPreviewImageInfo {
  pageNumber: number;
  fileName: string;
  filePath: string;
  updatedAt: string;
}

export interface ProjectPreviewMetadata {
  scriptHash: string;
  generatedAt: string;
  slideCount: number;
  presentation: PreviewPresentation;
  images: Array<{ pageNumber: number; url: string }>;
  imageError?: string;
}

export function computeProjectScriptHash(projectId: string): string | null {
  const projectDir = getProjectDir(projectId);
  if (!existsSync(projectDir)) return null;

  const scriptFiles = readdirSync(projectDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.js'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (!scriptFiles.length) return null;

  try {
    const hash = createHash('sha256');
    for (const fileName of scriptFiles) {
      hash.update(`file:${fileName}\n`);
      hash.update(readFileSync(resolveProjectFile(projectId, fileName)));
      hash.update('\n');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
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

function getProjectPreviewMetadataPath(projectId: string): string {
  return resolveProjectFile(projectId, path.posix.join(PREVIEW_DIR_NAME, PREVIEW_METADATA_FILE));
}

export function readProjectPreviewMetadata(projectId: string): ProjectPreviewMetadata | null {
  const metadataPath = getProjectPreviewMetadataPath(projectId);
  if (!existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as ProjectPreviewMetadata;
    if (!parsed || typeof parsed.scriptHash !== 'string' || typeof parsed.generatedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProjectPreviewMetadata(projectId: string, metadata: ProjectPreviewMetadata): void {
  const metadataPath = getProjectPreviewMetadataPath(projectId);
  mkdirSync(path.dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export function buildProjectPreviewImageResponse(projectId: string, image: ProjectPreviewImageInfo): { pageNumber: number; url: string } {
  return {
    pageNumber: image.pageNumber,
    url: `/api/projects/${encodeURIComponent(projectId)}/files/raw?fileName=${encodeURIComponent(`preview/${image.fileName}`)}&t=${encodeURIComponent(image.updatedAt)}`,
  };
}

export function buildProjectPreviewImageResponses(projectId: string, images: ProjectPreviewImageInfo[]): Array<{ pageNumber: number; url: string }> {
  return images.map(image => buildProjectPreviewImageResponse(projectId, image));
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
    throw new Error('项目预览缓存还是空的，请先在页面里重新生成预览。');
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
