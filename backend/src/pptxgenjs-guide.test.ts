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
  assert.match(PPTXGENJS_GUIDE, /主标题 30、副标题 20、正文 18/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 30/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 20/);
  assert.match(PPTXGENJS_GUIDE, /fontSize: 18/);
});
