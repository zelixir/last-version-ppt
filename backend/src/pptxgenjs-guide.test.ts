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
