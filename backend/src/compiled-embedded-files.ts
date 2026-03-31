import { gunzipSync } from 'zlib';

declare const __LAST_VERSION_PPT_COMPILED__: boolean | undefined;

interface EmbeddedFileRegistration {
  embeddedName: string;
  compressed?: boolean;
}

interface EmbeddedFileBlob {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface EmbeddedFileState {
  cache: Map<string, Uint8Array>;
  filesByNormalizedName: Map<string, EmbeddedFileBlob>;
  sourceFiles: readonly EmbeddedFileBlob[] | null;
}

const STATE_KEY = Symbol.for('last-version-ppt.compiled-embedded-files');
// Bun 当前会在嵌入文件的最后一个扩展名前追加 8 位短哈希，例如 file-a1b2c3d4.js.gz，需要先去掉这段后缀再按逻辑文件名匹配。
const BUN_EMBEDDED_HASH_PATTERN = /-[a-z0-9]{8}(?=\.[^./]+$)/;

function toBaseFileName(fileName: string) {
  const normalizedPath = fileName.replace(/\\/g, '/');
  return normalizedPath.split('/').filter(Boolean).pop() ?? fileName;
}

function getState(): EmbeddedFileState {
  const scope = globalThis as typeof globalThis & { [STATE_KEY]?: EmbeddedFileState };
  if (!scope[STATE_KEY]) {
    scope[STATE_KEY] = {
      cache: new Map(),
      filesByNormalizedName: new Map(),
      sourceFiles: null,
    };
  }
  return scope[STATE_KEY]!;
}

function getEmbeddedFiles(): readonly EmbeddedFileBlob[] {
  const bunRuntime = (globalThis as typeof globalThis & {
    Bun?: {
      embeddedFiles?: readonly EmbeddedFileBlob[];
    };
  }).Bun;
  return bunRuntime?.embeddedFiles ?? [];
}

function normalizeEmbeddedFileName(fileName: string) {
  return toBaseFileName(fileName).replace(BUN_EMBEDDED_HASH_PATTERN, '');
}

function syncEmbeddedFileIndex() {
  const state = getState();
  const embeddedFiles = getEmbeddedFiles();
  if (state.sourceFiles === embeddedFiles) return state;

  state.sourceFiles = embeddedFiles;
  state.filesByNormalizedName = new Map(
    embeddedFiles.map(embeddedFile => [normalizeEmbeddedFileName(embeddedFile.name), embeddedFile]),
  );
  state.cache.clear();
  return state;
}

function findEmbeddedFile(logicalPath: string): { embeddedFile: EmbeddedFileBlob; compressed: boolean } | null {
  const fileName = toBaseFileName(logicalPath);
  const state = syncEmbeddedFileIndex();
  const directMatch = state.filesByNormalizedName.get(fileName);
  if (directMatch) {
    return { embeddedFile: directMatch, compressed: false };
  }

  const compressedMatch = state.filesByNormalizedName.get(`${fileName}.gz`);
  if (compressedMatch) {
    return { embeddedFile: compressedMatch, compressed: true };
  }

  return null;
}

export function isCompiledBuild(): boolean {
  return typeof __LAST_VERSION_PPT_COMPILED__ !== 'undefined' && __LAST_VERSION_PPT_COMPILED__ === true;
}

export function hasCompiledEmbeddedFiles(): boolean {
  return isCompiledBuild() && syncEmbeddedFileIndex().filesByNormalizedName.size > 0;
}

export function hasCompiledEmbeddedFile(logicalPath: string): boolean {
  if (!isCompiledBuild()) return false;
  return Boolean(findEmbeddedFile(logicalPath));
}

export function getCompiledEmbeddedFileRegistration(logicalPath: string): EmbeddedFileRegistration | null {
  if (!isCompiledBuild()) return null;
  const resolved = findEmbeddedFile(logicalPath);
  if (!resolved) return null;
  return {
    embeddedName: resolved.embeddedFile.name,
    compressed: resolved.compressed,
  };
}

export async function readCompiledEmbeddedFile(logicalPath: string): Promise<Uint8Array | null> {
  if (!isCompiledBuild()) return null;

  const state = syncEmbeddedFileIndex();
  const cached = state.cache.get(logicalPath);
  if (cached) return cached;

  const resolved = findEmbeddedFile(logicalPath);
  if (!resolved) return null;

  const rawBytes = new Uint8Array(await resolved.embeddedFile.arrayBuffer());
  const data = resolved.compressed ? new Uint8Array(gunzipSync(rawBytes)) : rawBytes;
  state.cache.set(logicalPath, data);
  return data;
}
