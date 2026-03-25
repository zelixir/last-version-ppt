import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { LibreOfficeWasmOptions } from '@matbee/libreoffice-converter';

type WasmLoaderModule = NonNullable<LibreOfficeWasmOptions['wasmLoader']>;

interface BunFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface BunRuntimeLike {
  version: string;
  file(path: string | URL): BunFileLike;
}

const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntimeLike }).Bun;
const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBEDDED_WASM_FILES = [
  'loader.cjs',
  'soffice.cjs',
  'soffice.js',
  'soffice.data',
  'soffice.wasm',
  'soffice.worker.cjs',
  'soffice.worker.js',
  'soffice-bun-worker.cjs',
] as const;
let extractedWasmDirPromise: Promise<string> | null = null;

function resolveConverterPackageRoot() {
  // 直接使用 submodule 路径
  return resolve(__dirname, '..', 'libreoffice-document-converter');
}

function hasAllRuntimeFiles(wasmDir: string) {
  return EMBEDDED_WASM_FILES.every(fileName => existsSync(join(wasmDir, fileName)));
}

function isBundledBunPath(filePath: string) {
  return filePath.startsWith('/$bunfs/');
}

function isBunRuntime() {
  return Boolean(bunRuntime?.version);
}

function resolveInstalledWasmDir() {
  const wasmDir = resolve(resolveConverterPackageRoot(), 'wasm');
  return hasAllRuntimeFiles(wasmDir) ? wasmDir : null;
}

function resolvePackagedWasmDir() {
  try {
    const loaderPath = join(resolveConverterPackageRoot(), 'wasm', 'loader.cjs');
    const wasmDir = dirname(loaderPath);
    if (isBunRuntime() && isBundledBunPath(wasmDir)) {
      return null;
    }
    return hasAllRuntimeFiles(wasmDir) ? wasmDir : null;
  } catch {
    return null;
  }
}

async function extractBundledWasmDir() {
  if (!bunRuntime) {
    throw new Error('当前环境没有可用的 Bun 运行时');
  }

  const wasmDir = join(tmpdir(), 'ppt-libreoffice-runtime', 'matbee-converter', 'wasm');
  mkdirSync(wasmDir, { recursive: true });

  for (const fileName of EMBEDDED_WASM_FILES) {
    const targetPath = join(wasmDir, fileName);
    if (existsSync(targetPath)) continue;
    const fileData = await bunRuntime.file(join(resolveConverterPackageRoot(), 'wasm', fileName)).arrayBuffer();
    await writeFile(targetPath, new Uint8Array(fileData));
  }

  return wasmDir;
}

async function resolveWasmDir() {
  const installedWasmDir = resolveInstalledWasmDir();
  if (installedWasmDir) {
    return installedWasmDir;
  }

  const packagedWasmDir = resolvePackagedWasmDir();
  if (packagedWasmDir) {
    return packagedWasmDir;
  }

  if (isBunRuntime()) {
    if (!extractedWasmDirPromise) {
      extractedWasmDirPromise = extractBundledWasmDir().catch((error: unknown) => {
        extractedWasmDirPromise = null;
        throw error;
      });
    }
    return await extractedWasmDirPromise;
  }

  throw new Error('没有找到 LibreOffice 运行时文件，请先在项目根目录执行 bun install');
}

export async function resolveLibreOfficeRuntime() {
  const wasmDir = await resolveWasmDir();
  const loaderPath = join(wasmDir, 'loader.cjs');
  // 使用动态 import 以支持 Bun 环境
  const loaderModule = await import(loaderPath);
  return {
    wasmDir,
    wasmLoader: (loaderModule.default || loaderModule) as WasmLoaderModule,
  };
}
