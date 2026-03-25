import { createConverter, type LibreOfficeConverter, type LibreOfficeWasmOptions } from '@matbee/libreoffice-converter';
import { loadSelectedFontData, getSelectedFontNames } from './font-preferences.ts';
import { resolveLibreOfficeRuntime } from './libreoffice-runtime.ts';

type WasmLoaderModule = NonNullable<LibreOfficeWasmOptions['wasmLoader']>;

let sharedConverterPromise: Promise<LibreOfficeConverter> | null = null;
let converterFontKey: string | null = null;

async function buildSharedConverter(fontKey: string): Promise<LibreOfficeConverter> {
  const runtime = await resolveLibreOfficeRuntime();
  const fonts = loadSelectedFontData();

  const converter = await createConverter({
    wasmPath: runtime.wasmDir,
    wasmLoader: runtime.wasmLoader as WasmLoaderModule,
    fonts,
  });

  return converter;
}

export async function getSharedConverter(): Promise<LibreOfficeConverter> {
  const fontKey = getSelectedFontNames().join('|') || 'none';
  if (sharedConverterPromise && converterFontKey === fontKey) return sharedConverterPromise;

  const previous = sharedConverterPromise;
  converterFontKey = fontKey;
  sharedConverterPromise = buildSharedConverter(fontKey);

  if (previous && previous !== sharedConverterPromise) {
    previous.then(converter => converter.destroy().catch(() => undefined)).catch(() => undefined);
  }

  return sharedConverterPromise;
}

export function invalidateSharedConverter(): void {
  converterFontKey = null;
  sharedConverterPromise = null;
}
