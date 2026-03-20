import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

interface WasmLoaderModule {
  createModule(config: Record<string, unknown>): unknown;
}

interface BunFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface BunRuntimeLike {
  version: string;
  file(path: string | URL): BunFileLike;
}

const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntimeLike }).Bun;
const EMBEDDED_WASM_FILES = [
  'loader.cjs',
  'soffice.cjs',
  'soffice.js',
  'soffice.data',
  'soffice.wasm',
  'soffice.worker.cjs',
  'soffice.worker.js',
] as const;
const EMBEDDED_WASM_URLS = Object.fromEntries(
  EMBEDDED_WASM_FILES.map(fileName => [
    fileName,
    new URL(`../../frontend/node_modules/@matbee/libreoffice-converter/wasm/${fileName}`, import.meta.url),
  ]),
) as Record<(typeof EMBEDDED_WASM_FILES)[number], URL>;

let extractedWasmDirPromise: Promise<string> | null = null;

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
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const wasmDir = resolve(sourceDir, '..', '..', 'frontend', 'node_modules', '@matbee', 'libreoffice-converter', 'wasm');
  return hasAllRuntimeFiles(wasmDir) ? wasmDir : null;
}

function resolvePackagedWasmDir() {
  try {
    const loaderPath = fileURLToPath(EMBEDDED_WASM_URLS['loader.cjs']);
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

  const wasmDir = join(tmpdir(), 'last-version-ppt-libreoffice', `${process.pid}`, 'wasm');
  mkdirSync(wasmDir, { recursive: true });

  for (const fileName of EMBEDDED_WASM_FILES) {
    const targetPath = join(wasmDir, fileName);
    if (existsSync(targetPath)) continue;
    const fileData = await bunRuntime.file(EMBEDDED_WASM_URLS[fileName]).arrayBuffer();
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
  const require = createRequire(import.meta.url);
  const loaderPath = join(wasmDir, 'loader.cjs');
  return {
    wasmDir,
    wasmLoader: require(loaderPath) as WasmLoaderModule,
  };
}
