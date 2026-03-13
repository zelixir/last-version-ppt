import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { createWorkerConverter, rgbaToPng } from '@matbee/libreoffice-converter';
import wasmLoader from '@matbee/libreoffice-converter/wasm/loader';

const RESULT_PREFIX = '__RESULT__';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function renderPageBuffer(converter, pptxBuffer, pageIndex) {
  const page = await converter.renderPageFullQuality(
    pptxBuffer,
    { inputFormat: 'pptx' },
    pageIndex,
    { dpi: 144 },
  );
  return rgbaToPng(page.data, page.width, page.height);
}

const payloadText = await readStdin();
const payload = JSON.parse(payloadText || '{}');
const pptxBuffer = readFileSync(String(payload.inputPath || ''));
const converter = await createWorkerConverter({
  wasmLoader,
  wasmPath: wasmLoader.wasmDir,
});

try {
  const slideCount = await converter.getPageCount(pptxBuffer, { inputFormat: 'pptx' });
  if (payload.mode === 'page') {
    const pageNumber = Number(payload.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > slideCount) {
      throw new Error(`页码超出范围，当前共有 ${slideCount} 页`);
    }
    const pngBuffer = await renderPageBuffer(converter, pptxBuffer, pageNumber - 1);
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ slideCount, data: pngBuffer.toString('base64') })}\n`);
  } else {
    const outputDir = String(payload.outputDir || '');
    mkdirSync(outputDir, { recursive: true });
    const files = [];
    for (let pageIndex = 0; pageIndex < slideCount; pageIndex += 1) {
      const fileName = `slide-${pageIndex + 1}.png`;
      const filePath = path.join(outputDir, fileName);
      const pngBuffer = await renderPageBuffer(converter, pptxBuffer, pageIndex);
      writeFileSync(filePath, pngBuffer);
      files.push(fileName);
    }
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ slideCount, files })}\n`);
  }
} finally {
  await converter.destroy().catch(() => undefined);
}
