import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { resolveProjectFile } from './storage.ts';

export const TEXT_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.csv', '.html', '.css', '.xml', '.yml', '.yaml', '.svg']);
export const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
export const MAX_READ_FILE_BYTES = 20 * 1024;

export function isTextFile(fileName: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isImageFile(fileName: string): boolean {
  return IMAGE_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function getImageMediaType(fileName: string): string {
  switch (path.extname(fileName).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export function readProjectTextFile(projectId: string, fileName: string): { fileName: string; content: string; size: number } {
  if (!isTextFile(fileName)) throw new Error('该文件不是文本文件');
  const filePath = resolveProjectFile(projectId, fileName);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) throw new Error(`文件 ${fileName} 不存在`);
  const size = statSync(filePath).size;
  if (size > MAX_READ_FILE_BYTES) {
    throw new Error('文件超过 20KB，请改用 read-range 工具按行读取。');
  }
  return { fileName, content: readFileSync(filePath, 'utf8'), size };
}

export function readProjectTextFileRange(
  projectId: string,
  fileName: string,
  startLine: number,
  endLine: number,
): { fileName: string; totalLines: number; startLine: number; endLine: number; content: string } {
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error('startLine 必须是大于等于 1 的整数');
  if (!Number.isInteger(endLine) || endLine < startLine) throw new Error('endLine 必须是大于等于 startLine 的整数');
  if (!isTextFile(fileName)) throw new Error('该文件不是文本文件');
  const filePath = resolveProjectFile(projectId, fileName);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) throw new Error(`文件 ${fileName} 不存在`);
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  const totalLines = lines.length;
  const actualStart = Math.min(startLine, totalLines || startLine);
  const actualEnd = Math.min(endLine, totalLines);
  return {
    fileName,
    totalLines,
    startLine: actualStart,
    endLine: actualEnd,
    content: actualEnd >= actualStart ? lines.slice(actualStart - 1, actualEnd).join('\n') : '',
  };
}

export function buildImageToolModelOutput(label: string, fileName: string, mediaType: string, data: string) {
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text: label },
      { type: 'file-data' as const, data, mediaType, filename: fileName },
    ],
  };
}
