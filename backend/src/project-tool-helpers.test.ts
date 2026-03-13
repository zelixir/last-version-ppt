import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, rmSync, statSync, writeFileSync } from 'fs';
import PptxGenJS from 'pptxgenjs';
import { toDashscopeToolContent } from './dashscope-message-content.ts';
import { generateProjectPreviewImages } from './project-preview.ts';
import { buildImageToolModelOutput, readProjectTextFile, readProjectTextFileRange } from './project-tool-helpers.ts';
import { renderPptPageAsImage, renderPptPageAsSvg } from './slide-render.ts';
import { createProjectFiles, getProjectDir, resolveProjectFile } from './storage.ts';

async function withTestProject(run: (projectId: string) => Promise<void> | void) {
  const projectId = `test-tool-helper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    await run(projectId);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
}

test('大文件会提示改用按行读取工具', async () => {
  await withTestProject(async projectId => {
    writeFileSync(resolveProjectFile(projectId, 'notes.txt'), ['第 1 行', '第 2 行', '第 3 行', '第 4 行'].join('\n'), 'utf8');
    writeFileSync(resolveProjectFile(projectId, 'big.txt'), 'A'.repeat(20 * 1024 + 1), 'utf8');

    const file = readProjectTextFile(projectId, 'notes.txt');
    assert.equal(file.content, '第 1 行\n第 2 行\n第 3 行\n第 4 行');

    const range = await readProjectTextFileRange(projectId, 'notes.txt', 2, 3);
    assert.equal(range.totalLines, 4);
    assert.equal(range.content, '第 2 行\n第 3 行');

    assert.throws(() => readProjectTextFile(projectId, 'big.txt'), /read-range 工具按行读取/);
  });
});

test('图片工具结果会保留给多模态模型使用的图片内容', () => {
  const output = buildImageToolModelOutput('图片 cover.svg', 'cover.svg', 'image/svg+xml', 'PHN2Zz48L3N2Zz4=');
  assert.equal(output.type, 'content');
  assert.equal(output.value[1].type, 'file-data');

  const dashscopeContent = toDashscopeToolContent({
    type: 'content',
    value: [
      { type: 'text', text: '图片 cover.svg' },
      { type: 'file-data', data: 'PHN2Zz48L3N2Zz4=', mediaType: 'image/svg+xml', filename: 'cover.svg' },
    ],
  });

  assert.deepEqual(dashscopeContent, [
    { type: 'text', text: '图片 cover.svg' },
    { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } },
  ]);
});

test('可以把指定页面渲染成预览图片', async () => {
  await withTestProject(async projectId => {
    const { runProject } = await import('./project-runner.ts');
    const result = await runProject({ projectId });
    assert.equal(result.ok, true);
    assert.ok(result.pptx);

    const preview = await renderPptPageAsImage(result.pptx!, 1);
    assert.equal(preview.slideCount, 1);
    assert.equal(preview.mediaType, 'image/png');
    assert.ok(Buffer.from(preview.data, 'base64').length > 1000);
  });
});

test('会把预览图写入项目 preview 文件夹', async () => {
  await withTestProject(async projectId => {
    const { runProject } = await import('./project-runner.ts');
    const result = await runProject({ projectId });
    assert.equal(result.ok, true);
    assert.ok(result.pptx);

    const preview = await generateProjectPreviewImages(projectId, result.pptx!);
    assert.equal(preview.slideCount, 1);
    assert.deepEqual(preview.files, ['preview/slide-1.png']);
    const outputPath = resolveProjectFile(projectId, preview.files[0]!);
    assert.ok(existsSync(outputPath));
    assert.ok(statSync(outputPath).size > 1000);
  });
});

test('预览渲染会保留富文本 breakLine 和字符串换行', () => {
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();

  slide.addText([
    { text: '第一行', options: { breakLine: true } },
    { text: '第二行', options: { breakLine: true } },
    { text: '第三行' },
  ], { x: 1, y: 1, w: 4, h: 2, fontSize: 24, color: '000000' });

  slide.addText('甲\n乙\n丙', { x: 1, y: 3.5, w: 4, h: 2, fontSize: 24, color: '000000' });

  const { svg } = renderPptPageAsSvg(pptx, 1);
  assert.match(svg, /第一行<\/tspan><tspan[^>]*>第二行<\/tspan><tspan[^>]*>第三行/);
  assert.match(svg, /甲<\/tspan><tspan[^>]*>乙<\/tspan><tspan[^>]*>丙/);
});

test('预览渲染会按文本框宽度自动换行中文正文', () => {
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();

  slide.addText('请在右侧告诉智能助手，你想做什么样的演示稿。', {
    x: 0.8,
    y: 1.96,
    w: 11,
    h: 1.72,
    fontSize: 56,
    color: '334155',
  });

  const { svg } = renderPptPageAsSvg(pptx, 1);
  assert.match(svg, /请在右侧告诉智能助手，你想做/);
  assert.match(svg, /什么样的演示稿。/);
  assert.match(svg, /<\/tspan><tspan[^>]*>/);
});
