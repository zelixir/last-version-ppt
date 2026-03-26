import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import readline from 'node:readline';
import path from 'path';
import { resolveProjectFile } from './storage.ts';

export const TEXT_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.csv', '.html', '.css', '.xml', '.yml', '.yaml', '.svg']);
export const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
export const MAX_READ_FILE_BYTES = 20 * 1024;
export const MAX_READ_INDEX_FILE_BYTES = 50 * 1024;

function getReadFileByteLimit(fileName: string): number {
  const normalized = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length === 1 && segments[0] === 'index.js' ? MAX_READ_INDEX_FILE_BYTES : MAX_READ_FILE_BYTES;
}

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
  const maxBytes = getReadFileByteLimit(fileName);
  if (size > maxBytes) {
    throw new Error(`文件超过 ${Math.floor(maxBytes / 1024)}KB，请改用 read-range 工具按行读取。`);
  }
  return { fileName, content: readFileSync(filePath, 'utf8'), size };
}

export async function readProjectTextFileRange(
  projectId: string,
  fileName: string,
  startLine: number,
  endLine: number,
): Promise<{ fileName: string; totalLines: number; startLine: number; endLine: number; content: string }> {
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error('起始行号必须是大于等于 1 的整数');
  if (!Number.isInteger(endLine) || endLine < startLine) throw new Error('结束行号必须大于等于起始行号');
  if (!isTextFile(fileName)) throw new Error('该文件不是文本文件');
  const filePath = resolveProjectFile(projectId, fileName);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) throw new Error(`文件 ${fileName} 不存在`);

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const selectedLines: string[] = [];
  let totalLines = 0;

  try {
    for await (const line of reader) {
      totalLines += 1;
      if (totalLines >= startLine && totalLines <= endLine) {
        selectedLines.push(line);
      }
    }
  } finally {
    reader.close();
    stream.close();
  }

  const actualStart = Math.min(startLine, totalLines || startLine);
  const actualEnd = Math.min(endLine, totalLines);
  return {
    fileName,
    totalLines,
    startLine: actualStart,
    endLine: actualEnd,
    content: actualEnd >= actualStart ? selectedLines.join('\n') : '',
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
