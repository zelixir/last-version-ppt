import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PPT_TEXT_CHAR_WIDTH_FACTOR,
  PPT_TEXT_LINE_HEIGHT_FACTOR,
  PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS,
  calculateMaxCharsPerLine,
  calculateSafeTextBoxHeight,
  calculateTextBoxHeight,
  recommendSingleLineChars,
} from './ppt-text-layout.ts';

test('PptxGenJS text box heights follow the verified line-height formula', () => {
  assert.equal(PPT_TEXT_LINE_HEIGHT_FACTOR, 1.67);
  assert.equal(calculateTextBoxHeight(88), 1.47);
  assert.equal(calculateTextBoxHeight(72), 1.21);
  assert.equal(calculateTextBoxHeight(56), 0.94);
  assert.equal(calculateTextBoxHeight(48), 0.81);
  assert.equal(calculateSafeTextBoxHeight(48, 3), 2.43);
});

test('PptxGenJS single-line character estimates match the default template widths', () => {
  assert.equal(PPT_TEXT_CHAR_WIDTH_FACTOR, 2.3);
  assert.equal(PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS, 4);
  assert.equal(calculateMaxCharsPerLine(11.56, 56), 34);
  assert.equal(calculateMaxCharsPerLine(6.98, 48), 24);
  assert.equal(calculateMaxCharsPerLine(5.16, 48), 17);
  assert.equal(recommendSingleLineChars(11.56, 56), 30);
  assert.equal(recommendSingleLineChars(6.98, 48), 20);
  assert.equal(recommendSingleLineChars(5.16, 48), 13);
});
