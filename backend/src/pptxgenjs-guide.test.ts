import assert from 'node:assert/strict';
import test from 'node:test';

import { PPTXGENJS_GUIDE } from './pptxgenjs-guide.ts';

test('PPTXGENJS_GUIDE includes detailed examples and common APIs', () => {
  assert.match(PPTXGENJS_GUIDE, /module\.exports = async function buildPresentation/);
  assert.match(PPTXGENJS_GUIDE, /addSlide/);
  assert.match(PPTXGENJS_GUIDE, /addText/);
  assert.match(PPTXGENJS_GUIDE, /addImage/);
  assert.match(PPTXGENJS_GUIDE, /addTable/);
  assert.match(PPTXGENJS_GUIDE, /addChart/);
  assert.match(PPTXGENJS_GUIDE, /defineLayout/);
  assert.match(PPTXGENJS_GUIDE, /getResourceUrl/);
});

test('PPTXGENJS_GUIDE matches the actual runtime shape of pptx and pptxgenjs', () => {
  assert.match(PPTXGENJS_GUIDE, /pptxgenjs：PptxGenJS 构造函数本身/);
  assert.match(PPTXGENJS_GUIDE, /pptx instanceof pptxgenjs/);
  assert.match(PPTXGENJS_GUIDE, /pptx\.ShapeType\.roundRect/);
  assert.match(PPTXGENJS_GUIDE, /pptx\.ChartType\.bar/);
  assert.match(PPTXGENJS_GUIDE, /LAYOUT_16x9/);
  assert.match(PPTXGENJS_GUIDE, /LAYOUT_4x3/);
  assert.doesNotMatch(PPTXGENJS_GUIDE, /pptxgenjs\.ShapeType/);
  assert.doesNotMatch(PPTXGENJS_GUIDE, /pptxgenjs\.ChartType/);
  assert.doesNotMatch(PPTXGENJS_GUIDE, /LAYOUT_16X9/);
  assert.doesNotMatch(PPTXGENJS_GUIDE, /LAYOUT_4X3/);
  assert.doesNotMatch(PPTXGENJS_GUIDE, /ChartType\.column/);
});

test('PPTXGENJS_GUIDE recommends the updated default text sizes', () => {
  assert.match(PPTXGENJS_GUIDE, /封面主标题 88、页标题 72、副标题 56、正文 48/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 88/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 72/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 56/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 48/);
  assert.match(PPTXGENJS_GUIDE, /fontSize × 1\.67 ÷ 100 × 行数/);
  assert.match(PPTXGENJS_GUIDE, /safeH = h \+ 0\.02/);
  assert.match(PPTXGENJS_GUIDE, /measureText\(text\)\.width; 再确认 widthPx <= w × 96 × 0\.96/);
  assert.match(PPTXGENJS_GUIDE, /约 1\.00 × fontSize 的宽度来算/);
  assert.match(PPTXGENJS_GUIDE, /当前 recommendSingleLineChars 和 maxChars 一致，因为固定预留字符现在就是 0/);
  assert.match(PPTXGENJS_GUIDE, /目录说明框 w 6\.98、fontSize 48 时，按安全宽度折算约 13 字/);
  assert.match(PPTXGENJS_GUIDE, /正文右侧说明框 w 5\.16、fontSize 48 时，按安全宽度折算约 9 字/);
  assert.match(PPTXGENJS_GUIDE, /margin: 0/);
  assert.match(PPTXGENJS_GUIDE, /左右各 0\.72 英寸边距/);
  assert.match(PPTXGENJS_GUIDE, /先放最关键结果/);
  assert.match(PPTXGENJS_GUIDE, /写清时间和负责人/);
});

test('PPTXGENJS_GUIDE explains the correct line break usage', () => {
  assert.match(PPTXGENJS_GUIDE, /简单换行（最稳妥）/);
  assert.match(PPTXGENJS_GUIDE, /\\n/);
  assert.match(PPTXGENJS_GUIDE, /富文本分段换行/);
  assert.match(PPTXGENJS_GUIDE, /breakLine: true/);
});
