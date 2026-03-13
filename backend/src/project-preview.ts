import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'os';
import path from 'path';
import PptxGenJS from 'pptxgenjs';
import { getProjectDir } from './storage.ts';

const EMU_PER_INCH = 914400;
const PREVIEW_DIRECTORY = 'preview';
const RUNNER_RESULT_PREFIX = '__RESULT__';
const previewRunnerPath = new URL('./project-preview-node.mjs', import.meta.url);

function toInches(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.abs(value) > 1000 ? value / EMU_PER_INCH : value;
}

function createTempPptxFile(pptxBuffer: Buffer): { tempDir: string; pptxPath: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'ppt-preview-temp-'));
  const pptxPath = path.join(tempDir, 'preview-source.pptx');
  writeFileSync(pptxPath, pptxBuffer);
  return { tempDir, pptxPath };
}

function runPreviewNode<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    // 运行环境已经依赖 Node.js 安装，这里直接调用 node 子进程来执行更稳定的 wasm 转换。
    const child = spawn('node', [previewRunnerPath.pathname], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const errorCodeText = code ?? '未知';
        reject(new Error(stderr.trim() || stdout.trim() || `预览转换未完成（错误代码：${errorCodeText}）`));
        return;
      }

      const resultLine = stdout
        .split(/\r?\n/)
        .reverse()
        .find(line => line.startsWith(RUNNER_RESULT_PREFIX));
      if (!resultLine) {
        reject(new Error(stderr.trim() || '预览转换没有返回结果'));
        return;
      }

      try {
        resolve(JSON.parse(resultLine.slice(RUNNER_RESULT_PREFIX.length)) as T);
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : String(error)));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
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
  const pptxBuffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as Uint8Array);
  const { tempDir, pptxPath } = createTempPptxFile(pptxBuffer);
  try {
    const result = await runPreviewNode<{ slideCount: number; data: string }>({
      mode: 'page',
      inputPath: pptxPath,
      pageNumber,
    });
    return {
      slideCount: result.slideCount,
      mediaType: 'image/png',
      data: result.data,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export interface ProjectPreviewResult {
  width: number;
  height: number;
  slideCount: number;
  files: string[];
}

export async function generateProjectPreviewImages(projectId: string, pptx: PptxGenJS): Promise<ProjectPreviewResult> {
  const pptxBuffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as Uint8Array);
  const { tempDir, pptxPath } = createTempPptxFile(pptxBuffer);
  const previewDir = path.join(getProjectDir(projectId), PREVIEW_DIRECTORY);
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  try {
    const result = await runPreviewNode<{ slideCount: number; files: string[] }>({
      mode: 'all',
      inputPath: pptxPath,
      outputDir: previewDir,
    });
    return {
      ...getPptPreviewSize(pptx),
      slideCount: result.slideCount,
      files: result.files.map(fileName => `${PREVIEW_DIRECTORY}/${fileName}`),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
