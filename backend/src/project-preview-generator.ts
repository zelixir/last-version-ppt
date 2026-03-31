import { rgbaToPng } from './libreoffice-converter.ts';
import type { ProjectPreviewImageInfo } from './project-preview-cache.ts';
import { buildProjectPreviewImageResponse, replaceProjectPreviewImages } from './project-preview-cache.ts';
import { getSharedConverter } from './shared-libreoffice-converter.ts';

const PREVIEW_WIDTH = 1600;
type PreviewRenderer = (pptxData: Uint8Array, width: number) => Promise<Array<{ pageNumber: number; data: Uint8Array }>>;

interface GenerateProjectPreviewImagesOptions {
  renderPreviews?: PreviewRenderer;
  onProgress?: (progress: PreviewProgressUpdate) => void;
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
export interface PreviewProgressUpdate {
  message: string;
  percent?: number;
}

function buildPreviewGenerationResult(
  projectId: string,
  images: ProjectPreviewImageInfo[],
): ProjectPreviewGenerationResult {
  return {
    slideCount: images.length,
    images: images.map(image => buildProjectPreviewImageResponse(projectId, image)),
  };
}

function toUint8Array(data: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function renderPreviewImagesWithLibreOffice(
  pptxData: Uint8Array,
  width: number,
  onProgress?: (progress: PreviewProgressUpdate) => void,
): Promise<Array<{ pageNumber: number; data: Uint8Array }>> {
  const converter = await getSharedConverter();
  const pageCount = await converter.getPageCount(pptxData, { inputFormat: 'pptx' });
  if (pageCount < 1) {
    throw new Error('PPT 里还没有可预览的页面');
  }

  const renderedPages: Array<{ pageNumber: number; data: Uint8Array }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const percent = Math.min(98, Math.max(25, Math.round(((pageIndex + 1) / pageCount) * 80) + 15));
    onProgress?.({ message: `正在生成第 ${pageIndex + 1}/${pageCount} 页的预览图…`, percent });
    const preview = await converter.renderPage(pptxData, { inputFormat: 'pptx' }, pageIndex, width);
    const png = await rgbaToPng(preview.data, preview.width, preview.height);
    renderedPages.push({
      pageNumber: pageIndex + 1,
      data: toUint8Array(png),
    });
  }

  onProgress?.({ message: '预览图已经生成', percent: 100 });
  return renderedPages;
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
    options.onProgress?.({ message: '正在准备预览引擎…', percent: 10 });
    const renderPreviews = options.renderPreviews
      ?? ((data, width) => renderPreviewImagesWithLibreOffice(data, width, options.onProgress));
    const images = await renderPreviews(pptxData, PREVIEW_WIDTH);
    const storedImages = replaceProjectPreviewImages(projectId, images);
    return buildPreviewGenerationResult(projectId, storedImages);
  });
}
