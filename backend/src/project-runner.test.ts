import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, writeFileSync } from 'fs';

import { runProject } from './project-runner.ts';
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
      `module.exports = async function buildPresentation({ pptx, pptxgenjs, getResourceUrl, getResourcePath, measureText, log, assert, projectId, projectDir, path }) {
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
  if (typeof getResourceUrl !== 'function' || typeof getResourcePath !== 'function' || typeof measureText !== 'function' || typeof log !== 'function' || typeof assert !== 'function') {
    throw new Error('上下文函数缺失');
  }
  if (typeof projectId !== 'string' || typeof projectDir !== 'string' || typeof path?.join !== 'function') {
    throw new Error('项目信息缺失');
  }

  const measured = measureText('新的演示文稿', { fontSize: 88, fontFace: 'Microsoft YaHei', width: 11.56 });
  if (typeof measured?.width !== 'number' || measured.width <= 0) throw new Error('measureText 不可用');

  pptx.layout = 'LAYOUT_16x9';
  const cover = pptx.addSlide();
  cover.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 0.5, w: 2, h: 1, fill: { color: 'FFFFFF' }, line: { color: '2563EB', pt: 1 } });
  const chartSlide = pptx.addSlide();
  chartSlide.addChart(pptx.ChartType.bar, [{ name: '示例', labels: ['一月', '二月'], values: [1, 2] }], { x: 0.5, y: 0.5, w: 4, h: 2.5, showLegend: false });
  log(JSON.stringify({
    resourceUrl: getResourceUrl('封面 图.png'),
     resourcePath: getResourcePath('cover.png'),
     measureWidth: measured.width,
     layout: pptx.layout,
    shapeType: pptx.ShapeType.roundRect,
    chartType: pptx.ChartType.bar
  }));
};`,
      'utf8',
    );

    const result = await runProject({ projectId });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.slideCount, 2);
    assert.equal(result.pptx?.layout, 'LAYOUT_16x9');
    assert.ok(result.logs.length > 0);

    const runtimeInfo = JSON.parse(result.logs.at(-1) ?? '{}');
    assert.equal(runtimeInfo.layout, 'LAYOUT_16x9');
    assert.ok(runtimeInfo.measureWidth > 0);
    assert.equal(runtimeInfo.shapeType, 'roundRect');
    assert.equal(runtimeInfo.chartType, 'bar');
    assert.match(runtimeInfo.resourceUrl, new RegExp(`^http://localhost:3101/${projectId}/`));
    assert.ok(runtimeInfo.resourceUrl.endsWith('%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png'));
    assert.equal(runtimeInfo.resourcePath, resolveProjectFile(projectId, 'cover.png'));
  });
});

test('runProject 的 assert 会收集 warning 而不是中断脚本', async () => {
  await withTestProject(async projectId => {
    writeFileSync(
      resolveProjectFile(projectId, 'index.js'),
      `module.exports = async function buildPresentation({ pptx, assert, log }) {
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText('测试', { x: 0.5, y: 0.5, w: 1.2, h: 0.6, fontSize: 24 });
  assert(false, '第一页标题超出安全区');
  assert.equal(1, 2, '编号不匹配');
  log('脚本仍然继续执行');
};`,
      'utf8',
    );

    const result = await runProject({ projectId });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.slideCount, 1);
    assert.deepEqual(result.warnings, ['第一页标题超出安全区', '编号不匹配']);
    assert.match(result.logs.join('\n'), /脚本仍然继续执行/);
  });
});

test('runProject 成功时也会把完整 warning 打到控制台', async () => {
  await withTestProject(async projectId => {
    writeFileSync(
      resolveProjectFile(projectId, 'index.js'),
      `module.exports = async function buildPresentation({ pptx, assert }) {
  pptx.addSlide();
  assert(false, '第一页：标题和副标题发生重叠');
  assert(false, '第一页：正文和图片发生重叠');
};`,
      'utf8',
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown, ...rest: unknown[]) => {
      warnings.push([message, ...rest].map(item => String(item)).join(' '));
    };
    try {
      const result = await runProject({ projectId });
      assert.equal(result.ok, true, result.error);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /\[PPT 脚本提醒\] 项目/);
    assert.match(warnings[0] ?? '', /第一页：标题和副标题发生重叠/);
    assert.match(warnings[0] ?? '', /第一页：正文和图片发生重叠/);
  });
});
