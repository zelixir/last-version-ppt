import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, writeFileSync } from 'fs';

import { pickPreferredChineseFontFamily, runProject } from './project-runner.ts';
import { createProjectFiles, getProjectDir, resolveProjectFile } from './storage.ts';

async function withTestProject(run: (projectId: string) => Promise<void> | void) {
  const projectId = `test-project-runner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createProjectFiles(projectId);
  try {
    await run(projectId);
  } finally {
    rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
}

test('runProject 提供的 PPT 脚本运行环境与指南示例一致', async () => {
  await withTestProject(async projectId => {
    writeFileSync(
      resolveProjectFile(projectId, 'index.js'),
      `module.exports = async function buildPresentation({ pptx, pptxgenjs, getResourceUrl, getResourcePath, log, projectId, projectDir, path }) {
  if (typeof pptxgenjs !== 'function') throw new Error('pptxgenjs 应该是构造函数');
  if (!(pptx instanceof pptxgenjs)) throw new Error('pptx 应该是 pptxgenjs 的实例');
  if (pptxgenjs.ShapeType !== undefined) throw new Error('pptxgenjs 上不应直接提供 ShapeType');
  if (pptxgenjs.ChartType !== undefined) throw new Error('pptxgenjs 上不应直接提供 ChartType');
  if (pptx.ShapeType?.roundRect !== 'roundRect') throw new Error('pptx.ShapeType.roundRect 不可用');
  if (pptx.ShapeType?.line !== 'line') throw new Error('pptx.ShapeType.line 不可用');
  if (pptx.ChartType?.bar !== 'bar') throw new Error('pptx.ChartType.bar 不可用');
  if (pptx.ChartType?.line !== 'line') throw new Error('pptx.ChartType.line 不可用');
  if (!('LAYOUT_WIDE' in pptx.LAYOUTS) || !('LAYOUT_16x9' in pptx.LAYOUTS) || !('LAYOUT_4x3' in pptx.LAYOUTS)) {
    throw new Error('缺少预期的布局常量');
  }
  if (typeof getResourceUrl !== 'function' || typeof getResourcePath !== 'function' || typeof log !== 'function') {
    throw new Error('上下文函数缺失');
  }
  if (typeof projectId !== 'string' || typeof projectDir !== 'string' || typeof path?.join !== 'function') {
    throw new Error('项目信息缺失');
  }

  pptx.layout = 'LAYOUT_16x9';
  const cover = pptx.addSlide();
  cover.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 0.5, w: 2, h: 1, fill: { color: 'FFFFFF' }, line: { color: '2563EB', pt: 1 } });
  const chartSlide = pptx.addSlide();
  chartSlide.addChart(pptx.ChartType.bar, [{ name: '示例', labels: ['一月', '二月'], values: [1, 2] }], { x: 0.5, y: 0.5, w: 4, h: 2.5, showLegend: false });
  log(JSON.stringify({
    resourceUrl: getResourceUrl('封面 图.png'),
    resourcePath: getResourcePath('cover.png'),
    layout: pptx.layout,
    shapeType: pptx.ShapeType.roundRect,
    chartType: pptx.ChartType.bar
  }));
};`,
      'utf8',
    );

    const result = await runProject({ projectId });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.slideCount, 2);
    assert.equal(result.pptx?.layout, 'LAYOUT_16x9');
    assert.ok(result.logs.length > 0);

    const runtimeInfo = JSON.parse(result.logs.at(-1) ?? '{}');
    assert.equal(runtimeInfo.layout, 'LAYOUT_16x9');
    assert.equal(runtimeInfo.shapeType, 'roundRect');
    assert.equal(runtimeInfo.chartType, 'bar');
    assert.match(runtimeInfo.resourceUrl, new RegExp(`^http://localhost:3101/${projectId}/`));
    assert.ok(runtimeInfo.resourceUrl.endsWith('%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png'));
    assert.equal(runtimeInfo.resourcePath, resolveProjectFile(projectId, 'cover.png'));
  });
});

test('pickPreferredChineseFontFamily 优先选择常见中文字体', () => {
  const preferred = pickPreferredChineseFontFamily([
    { name: 'Example.ttf', filePath: '/tmp/Example.ttf', size: 1, families: ['Arial', 'Noto Sans CJK SC'] },
    { name: 'Other.ttf', filePath: '/tmp/Other.ttf', size: 1, families: ['WenQuanYi Zen Hei'] },
  ]);

  assert.equal(preferred, 'Noto Sans CJK SC');
});
