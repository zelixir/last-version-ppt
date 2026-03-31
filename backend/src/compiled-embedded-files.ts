import { gunzipSync } from 'zlib';

interface EmbeddedFileRegistration {
  embeddedName: string;
  compressed?: boolean;
}

interface EmbeddedFileBlob {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface EmbeddedFileState {
  files: Map<string, EmbeddedFileRegistration>;
  cache: Map<string, Uint8Array>;
}

const STATE_KEY = Symbol.for('last-version-ppt.compiled-embedded-files');

function getState(): EmbeddedFileState {
  const scope = globalThis as typeof globalThis & { [STATE_KEY]?: EmbeddedFileState };
  if (!scope[STATE_KEY]) {
    scope[STATE_KEY] = {
      files: new Map(),
      cache: new Map(),
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

function normalizeEmbeddedFileName(embeddedName: string) {
  const normalizedPath = embeddedName.replace(/\\/g, '/');
  return normalizedPath.split('/').filter(Boolean).pop() ?? embeddedName;
}

function findEmbeddedFile(embeddedName: string): EmbeddedFileBlob | null {
  const normalizedName = normalizeEmbeddedFileName(embeddedName);
  for (const embeddedFile of getEmbeddedFiles()) {
    if (embeddedFile.name === embeddedName || embeddedFile.name === normalizedName) return embeddedFile;
  }
  return null;
}

export function registerCompiledEmbeddedFiles(entries: Record<string, EmbeddedFileRegistration>): void {
  const state = getState();
  state.files = new Map(Object.entries(entries));
  state.cache.clear();
}

export function hasCompiledEmbeddedFiles(): boolean {
  return getState().files.size > 0;
}

export function hasCompiledEmbeddedFile(logicalPath: string): boolean {
  return getState().files.has(logicalPath);
}

export function getCompiledEmbeddedFileRegistration(logicalPath: string): EmbeddedFileRegistration | null {
  return getState().files.get(logicalPath) ?? null;
}

export async function readCompiledEmbeddedFile(logicalPath: string): Promise<Uint8Array | null> {
  const state = getState();
  const cached = state.cache.get(logicalPath);
  if (cached) return cached;

  const registration = state.files.get(logicalPath);
  if (!registration) return null;

  const embeddedFile = findEmbeddedFile(registration.embeddedName);
  if (!embeddedFile) return null;

  const rawBytes = new Uint8Array(await embeddedFile.arrayBuffer());
  const data = registration.compressed ? new Uint8Array(gunzipSync(rawBytes)) : rawBytes;
  state.cache.set(logicalPath, data);
  return data;
}
