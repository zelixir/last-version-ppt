import { createRequire } from 'module';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import type PptxGenJS from 'pptxgenjs';
import { getProjectDir } from './storage.ts';

const require = createRequire(import.meta.url);

function getWorkerScriptPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, 'pptx-convert-worker.cjs');
}

function findNodeBinary(): string {
  // Try process.env.NODE_BINARY if explicitly set
  if (process.env.NODE_BINARY && existsSync(process.env.NODE_BINARY)) {
    return process.env.NODE_BINARY;
  }
  // Try to find node via PATH
  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, 'node');
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to well-known locations
  const candidates = [
    '/home/runner/work/_temp/ghcca-node/node/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/homebrew/bin/node',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'node';
}

export function getPreviewDir(projectId: string): string {
  return path.join(getProjectDir(projectId), 'preview');
}

export function listPreviewImages(projectId: string): string[] {
  const previewDir = getPreviewDir(projectId);
  if (!existsSync(previewDir)) return [];
  return readdirSync(previewDir)
    .filter(f => /^slide-\d+\.png$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return numA - numB;
    })
    .map(f => `preview/${f}`);
}

export async function generateProjectPreviewImages(projectId: string, pptx: PptxGenJS): Promise<string[]> {
  const slideCount = (pptx as any)._slides?.length ?? 0;
  if (slideCount === 0) return [];

  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
  const previewDir = getPreviewDir(projectId);
  mkdirSync(previewDir, { recursive: true });

  const input = JSON.stringify({
    pptxBase64: pptxBuffer.toString('base64'),
    slideCount,
    previewDir,
  });

  const nodeBinary = findNodeBinary();
  const workerScript = getWorkerScriptPath();

  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(nodeBinary, [workerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code: number | null) => {
      if (!stdout) {
        reject(new Error(`预览生成子进程异常退出 (code ${code})${stderr ? ': ' + stderr.slice(0, 500) : ''}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as { ok: boolean; files?: string[]; error?: string };
        if (result.ok && result.files) {
          resolve(result.files);
        } else {
          reject(new Error(result.error || '预览图生成失败'));
        }
      } catch {
        reject(new Error(`无法解析预览生成结果: ${stdout.slice(0, 200)}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`无法启动预览生成进程: ${err.message}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}
