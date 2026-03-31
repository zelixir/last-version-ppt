import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { LibreOfficeWasmOptions } from './libreoffice-converter.ts';
import {
  getCompiledEmbeddedFileRegistration,
  hasCompiledEmbeddedFile,
  readCompiledEmbeddedFile,
} from './compiled-embedded-files.ts';

type WasmLoaderModule = NonNullable<LibreOfficeWasmOptions['wasmLoader']>;

interface BunRuntimeLike {
  version: string;
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
const RUNTIME_VERSION_FILE = 'soffice.wasm';
const RUNTIME_VERSION_FALLBACK = 'runtime';
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

function getCompiledWasmLogicalPath(fileName: string) {
  return `libreoffice/wasm/${fileName}`;
}

async function extractBundledWasmDir() {
  if (!bunRuntime) {
    throw new Error('当前环境没有可用的 Bun 运行时');
  }

  const runtimeVersion = getCompiledEmbeddedFileRegistration(getCompiledWasmLogicalPath(RUNTIME_VERSION_FILE))?.embeddedName
    ?.replace(/[^a-zA-Z0-9._-]+/g, '-')
    ?? RUNTIME_VERSION_FALLBACK;
  const wasmDir = join(tmpdir(), 'ppt-libreoffice-runtime', runtimeVersion, 'wasm');
  mkdirSync(wasmDir, { recursive: true });

  for (const fileName of EMBEDDED_WASM_FILES) {
    const targetPath = join(wasmDir, fileName);
    if (existsSync(targetPath)) continue;
    const fileData = await readCompiledEmbeddedFile(getCompiledWasmLogicalPath(fileName));
    if (!fileData) {
      throw new Error(`没有找到嵌入的 LibreOffice 运行时文件：${fileName}`);
    }
    await writeFile(targetPath, fileData);
  }

  return wasmDir;
}

async function resolveWasmDir() {
  const installedWasmDir = resolveInstalledWasmDir();
  if (installedWasmDir) {
    return installedWasmDir;
  }

  const loaderPath = join(resolveConverterPackageRoot(), 'wasm', 'loader.cjs');
  const packagedWasmDir = dirname(loaderPath);
  if (!(isBunRuntime() && isBundledBunPath(packagedWasmDir)) && hasAllRuntimeFiles(packagedWasmDir)) {
    return packagedWasmDir;
  }

  if (isBunRuntime() && hasCompiledEmbeddedFile(getCompiledWasmLogicalPath('loader.cjs'))) {
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
