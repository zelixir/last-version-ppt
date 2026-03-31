/**
 * 后端预览测试脚本
 *
 * 直接运行并生成 PPT 预览图片，用于测试 libreoffice-converter 集成
 *
 * 使用方法:
 *   bun scripts/test-backend-preview.ts [pptx文件路径]
 *
 * 示例:
 *   bun scripts/test-backend-preview.ts backend/libreoffice-document-converter/tests/sample_test_1.pptx
 */

import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, extname, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// 导入后端预览生成器需要的模块
const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const projectRoot = resolve(__dir, '..');

// 动态导入 libreoffice-converter,使用 submodule 中的源码
const converterPath = join(projectRoot, 'backend', 'libreoffice-document-converter', 'wasm', 'loader.cjs');
const wasmLoader = await import(converterPath);

// 导入转换器类
const converterModulePath = join(projectRoot, 'backend', 'libreoffice-document-converter', 'src', 'converter-node.ts');
const { LibreOfficeConverter } = await import(converterModulePath);

// 导入图像工具
const imageUtilsPath = join(projectRoot, 'backend', 'libreoffice-document-converter', 'src', 'image-utils.ts');
const { rgbaToPng } = await import(imageUtilsPath);

interface PagePreview {
  page: number;
  data: Uint8Array;
  width: number;
  height: number;
}

async function renderPreviewImages(
  pptxData: Uint8Array,
  width: number = 1600,
): Promise<Array<{ pageNumber: number; data: Uint8Array }>> {
  const wasmPath = join(projectRoot, 'backend', 'libreoffice-document-converter', 'wasm');

  console.log('⚙️  初始化 LibreOffice WASM 转换器...');
  console.log(`   WASM 路径: ${wasmPath}`);

  const converter = new LibreOfficeConverter({
    wasmPath,
    wasmLoader: wasmLoader.default || wasmLoader,
    verbose: true,
  });

  try {
    await converter.initialize();
    console.log('✅ LibreOffice 初始化完成\n');

    const pageCount = await converter.getPageCount(pptxData, { inputFormat: 'pptx' });
    if (pageCount < 1) {
      throw new Error('PPT 里还没有可预览的页面');
    }

    console.log(`📄 幻灯片数量: ${pageCount}`);
    console.log('🖼️  正在渲染预览图片...\n');

    const renderedPages: Array<{ pageNumber: number; data: Uint8Array }> = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const preview = await converter.renderPage(pptxData, { inputFormat: 'pptx' }, pageIndex, width) as PagePreview;
      const png = await rgbaToPng(preview.data, preview.width, preview.height);
      renderedPages.push({
        pageNumber: pageIndex + 1,
        data: new Uint8Array(png),
      });
      process.stdout.write(`\r   已渲染 ${pageIndex + 1}/${pageCount} 页   `);
    }
    console.log('\n');

    return renderedPages;
  } finally {
    await converter.destroy().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('用法: bun scripts/test-backend-preview.ts <pptx文件路径>');
    console.log('');
    console.log('示例:');
    console.log('  bun scripts/test-backend-preview.ts backend/libreoffice-document-converter/tests/sample_test_1.pptx');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputDir = './preview-test-output';

  console.log('🐇 后端预览功能测试 - Bun + LibreOffice WASM');
  console.log('');
  console.log(`   输入文件:    ${inputPath}`);
  console.log(`   输出目录:    ${outputDir}/`);
  console.log('');

  if (!existsSync(inputPath)) {
    console.error(`❌ 输入文件不存在: ${inputPath}`);
    process.exit(1);
  }

  // 确保输出目录存在
  await mkdir(outputDir, { recursive: true });

  // 读取输入文件
  const inputData = await readFile(inputPath);
  const inputName = basename(inputPath, extname(inputPath));

  console.log('📖 正在读取 PPT 文件...');
  const pptxData = new Uint8Array(inputData);
  console.log(`   文件大小: ${(pptxData.length / 1024).toFixed(2)} KB\n`);

  // 渲染预览图片
  const startTime = Date.now();
  const images = await renderPreviewImages(pptxData, 1600);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // 保存图片
  console.log('💾 正在保存预览图片...');
  const savedFiles: string[] = [];
  for (const image of images) {
    const filename = `${inputName}-slide-${String(image.pageNumber).padStart(3, '0')}.png`;
    const outPath = join(outputDir, filename);
    await writeFile(outPath, image.data);
    savedFiles.push(outPath);
    console.log(`   ✓ ${filename}`);
  }

  console.log('');
  console.log(`✅ 完成! 用时 ${duration}秒，共生成 ${savedFiles.length} 张预览图`);
  console.log(`   预览图保存在: ${outputDir}/`);

  // 优雅退出 (Bun 的 pthread 需要手动退出)
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
