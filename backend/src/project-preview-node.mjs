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

/**
 * 把指定页导出成 PNG。
 * pageIndex 从 0 开始，传入的 converter 需要已经完成初始化。
 */
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
let payload;

try {
  payload = JSON.parse(payloadText || '{}');
} catch (error) {
  throw new Error(`预览转换需要 JSON 格式的参数：${error instanceof Error ? error.message : String(error)}`);
}
const inputPath = String(payload.inputPath || '');
if (!inputPath) {
  throw new Error('没有收到要转换的 PPT 文件');
}

let pptxBuffer;
try {
  pptxBuffer = readFileSync(inputPath);
} catch {
  throw new Error('找不到要转换的 PPT 文件');
}

let converter;
try {
  converter = await createWorkerConverter({
    wasmLoader,
    wasmPath: wasmLoader.wasmDir,
  });
} catch (error) {
  throw new Error(`wasm 转换器初始化失败：${error instanceof Error ? error.message : String(error)}`);
}

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
