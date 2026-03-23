import assert from 'node:assert/strict';
import test from 'node:test';
import PptxGenJS from 'pptxgenjs';
import { buildProjectPreviewPresentation } from './project-preview.ts';

const EMU_PER_INCH = 914400;

test('buildProjectPreviewPresentation 会把脚本结果序列化成前端可用的预览结构', () => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const slide = pptx.addSlide();
  slide.background = { color: 'F8FAFC' };
  slide.addText('你好，预览', {
    x: 0.5,
    y: 0.6,
    w: 3.2,
    h: 0.8,
    fontSize: 24,
    color: '2563EB',
    bold: true,
    fill: { color: 'FFFFFF' },
    line: { color: 'CBD5E1' },
  });
  slide.addImage({
    path: '/tmp/sample-project/20260323_预览迁移/cover.png',
    x: 1,
    y: 1.5,
    w: 2,
    h: 1.2,
  });

  const presentation = buildProjectPreviewPresentation(
    '20260323_预览迁移',
    pptx,
    ['脚本正常执行'],
    ['第一页标题偏上'],
  );

  assert.equal(presentation.width, (pptx as any)._presLayout.width / EMU_PER_INCH);
  assert.equal(presentation.height, (pptx as any)._presLayout.height / EMU_PER_INCH);
  assert.equal(presentation.slides.length, 1);
  assert.deepEqual(presentation.logs, ['脚本正常执行', '[警告] 第一页标题偏上']);
  assert.equal(presentation.slides[0]?.backgroundColor, 'F8FAFC');
  assert.equal(presentation.slides[0]?.elements[0]?.kind, 'text');
  assert.equal(presentation.slides[0]?.elements[1]?.kind, 'image');
  assert.match(
    (presentation.slides[0]?.elements[1] as { src?: string })?.src ?? '',
    /\/api\/projects\/20260323_%E9%A2%84%E8%A7%88%E8%BF%81%E7%A7%BB\/files\/raw\?fileName=cover\.png/,
  );
});
