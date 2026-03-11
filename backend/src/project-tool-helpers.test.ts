import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, writeFileSync } from 'fs';
import { toDashscopeToolContent } from './dashscope-message-content.ts';
import { buildImageToolModelOutput, readProjectTextFile, readProjectTextFileRange } from './project-tool-helpers.ts';
import { renderPptPageAsImage } from './slide-render.ts';
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

test('readProjectTextFile blocks oversized files and readProjectTextFileRange reads the requested lines', async () => {
  await withTestProject(projectId => {
    writeFileSync(resolveProjectFile(projectId, 'notes.txt'), ['第 1 行', '第 2 行', '第 3 行', '第 4 行'].join('\n'), 'utf8');
    writeFileSync(resolveProjectFile(projectId, 'big.txt'), 'A'.repeat(20 * 1024 + 1), 'utf8');

    const file = readProjectTextFile(projectId, 'notes.txt');
    assert.equal(file.content, '第 1 行\n第 2 行\n第 3 行\n第 4 行');

    const range = readProjectTextFileRange(projectId, 'notes.txt', 2, 3);
    assert.equal(range.totalLines, 4);
    assert.equal(range.content, '第 2 行\n第 3 行');

    assert.throws(() => readProjectTextFile(projectId, 'big.txt'), /read-range 工具按行读取/);
  });
});

test('buildImageToolModelOutput and toDashscopeToolContent preserve image payloads', () => {
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

test('renderPptPageAsImage returns an SVG preview for a slide', async () => {
  await withTestProject(async projectId => {
    const { runProject } = await import('./project-runner.ts');
    const result = await runProject({ projectId });
    assert.equal(result.ok, true);
    assert.ok(result.pptx);

    const preview = renderPptPageAsImage(result.pptx!, 1);
    assert.equal(preview.slideCount, 1);
    assert.equal(preview.mediaType, 'image/svg+xml');
    assert.match(Buffer.from(preview.data, 'base64').toString('utf8'), /<svg/);
  });
});
