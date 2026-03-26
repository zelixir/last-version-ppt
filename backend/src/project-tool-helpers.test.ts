import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, writeFileSync } from 'fs';
import { toDashscopeToolContent } from './dashscope-message-content.ts';
import { buildImageToolModelOutput, readProjectTextFile, readProjectTextFileRange } from './project-tool-helpers.ts';
import { readProjectPreviewImage, replaceProjectPreviewImages } from './project-preview-cache.ts';
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

test('index.js 可以读取到 50KB，但超过后仍会提示改用按行读取', async () => {
  await withTestProject(async projectId => {
    writeFileSync(resolveProjectFile(projectId, 'index.js'), 'A'.repeat(50 * 1024), 'utf8');
    const file = readProjectTextFile(projectId, '/index.js');
    assert.equal(file.size, 50 * 1024);
    assert.equal(file.content.length, 50 * 1024);

    writeFileSync(resolveProjectFile(projectId, 'index.js'), 'B'.repeat(50 * 1024 + 1), 'utf8');
    assert.throws(() => readProjectTextFile(projectId, 'index.js'), /文件超过 50KB/);
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

test('可以读取 preview 文件夹里的指定页面预览图片', async () => {
  await withTestProject(async projectId => {
    replaceProjectPreviewImages(projectId, [
      { pageNumber: 1, data: Uint8Array.from([1, 2, 3, 4]) },
      { pageNumber: 2, data: Uint8Array.from([5, 6, 7, 8]) },
    ]);

    const preview = readProjectPreviewImage(projectId, 1);
    assert.equal(preview.slideCount, 2);
    assert.equal(preview.mediaType, 'image/png');
    assert.equal(Buffer.from(preview.data, 'base64').toString('hex'), '01020304');
  });
});
