import { createConverter, rgbaToPng, type LibreOfficeWasmOptions } from '../../frontend/node_modules/@matbee/libreoffice-converter/dist/index.js';
import { resolveLibreOfficeRuntime } from './libreoffice-runtime.ts';
import { replaceProjectPreviewImages, type ProjectPreviewImageInfo } from './project-preview-cache.ts';

const PREVIEW_WIDTH = 1600;
type WasmLoaderModule = NonNullable<LibreOfficeWasmOptions['wasmLoader']>;

type PreviewRenderer = (pptxData: Uint8Array, width: number) => Promise<Array<{ pageNumber: number; data: Uint8Array }>>;

interface GenerateProjectPreviewImagesOptions {
  renderPreviews?: PreviewRenderer;
}

export interface ProjectPreviewImageResponse {
  pageNumber: number;
  url: string;
}

export interface ProjectPreviewGenerationResult {
  slideCount: number;
  images: ProjectPreviewImageResponse[];
}

let previewGenerationQueue: Promise<void> = Promise.resolve();

function buildPreviewImageUrl(projectId: string, image: ProjectPreviewImageInfo): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files/raw?fileName=${encodeURIComponent(`preview/${image.fileName}`)}&t=${encodeURIComponent(image.updatedAt)}`;
}

function buildPreviewGenerationResult(projectId: string, images: ProjectPreviewImageInfo[]): ProjectPreviewGenerationResult {
  return {
    slideCount: images.length,
    images: images.map(image => ({
      pageNumber: image.pageNumber,
      url: buildPreviewImageUrl(projectId, image),
    })),
  };
}

function toUint8Array(data: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function renderPreviewImagesWithLibreOffice(
  pptxData: Uint8Array,
  width: number,
): Promise<Array<{ pageNumber: number; data: Uint8Array }>> {
  const runtime = await resolveLibreOfficeRuntime();
  const converter = await createConverter({
    wasmPath: runtime.wasmDir,
    wasmLoader: runtime.wasmLoader as WasmLoaderModule,
  });
  try {
    const pageCount = await converter.getPageCount(pptxData, { inputFormat: 'pptx' });
    if (pageCount < 1) {
      throw new Error('PPT 里还没有可预览的页面');
    }

    const renderedPages: Array<{ pageNumber: number; data: Uint8Array }> = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const preview = await converter.renderPage(pptxData, { inputFormat: 'pptx' }, pageIndex, width);
      const png = await rgbaToPng(preview.data, preview.width, preview.height);
      renderedPages.push({
        pageNumber: pageIndex + 1,
        data: toUint8Array(png),
      });
    }

    return renderedPages;
  } finally {
    await converter.destroy().catch(() => undefined);
  }
}

async function runPreviewTask<T>(task: () => Promise<T>) {
  const previousTask = previewGenerationQueue;
  let releaseCurrentTask = () => {};

  previewGenerationQueue = new Promise(resolve => {
    releaseCurrentTask = resolve;
  });

  await previousTask.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrentTask();
  }
}

export async function generateProjectPreviewImages(
  projectId: string,
  pptxData: Uint8Array,
  options: GenerateProjectPreviewImagesOptions = {},
): Promise<ProjectPreviewGenerationResult> {
  return await runPreviewTask(async () => {
    const renderPreviews = options.renderPreviews ?? renderPreviewImagesWithLibreOffice;
    const images = await renderPreviews(pptxData, PREVIEW_WIDTH);
    const storedImages = replaceProjectPreviewImages(projectId, images);
    return buildPreviewGenerationResult(projectId, storedImages);
  });
}
