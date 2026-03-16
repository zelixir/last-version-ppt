import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PPT_TEXT_CHAR_WIDTH_FACTOR,
  PPT_TEXT_FULL_WIDTH_EM,
  PPT_TEXT_LINE_HEIGHT_FACTOR,
  PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS,
  calculateSafeSingleLineWidthPx,
  calculateMaxCharsPerLine,
  calculateSafeTextBoxHeight,
  calculateTextBoxHeight,
  doesTextFitSingleLine,
  estimateTextWidthPx,
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
  assert.equal(PPT_TEXT_CHAR_WIDTH_FACTOR, 1.78);
  assert.equal(PPT_TEXT_FULL_WIDTH_EM, 0.75);
  assert.equal(PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS, 2);
  assert.equal(calculateMaxCharsPerLine(11.56, 56), 26);
  assert.equal(calculateMaxCharsPerLine(6.98, 48), 18);
  assert.equal(calculateMaxCharsPerLine(5.16, 48), 13);
  assert.equal(recommendSingleLineChars(11.56, 56), 24);
  assert.equal(recommendSingleLineChars(6.98, 48), 16);
  assert.equal(recommendSingleLineChars(5.16, 48), 11);
});

test('Canvas-derived width estimates keep the default single-line examples within the safe width', () => {
  assert.equal(estimateTextWidthPx('先讲清主题和要解决的问题。', 48), 468);
  assert.equal(estimateTextWidthPx('写清时间和负责人。', 48), 324);
  assert.equal(calculateSafeSingleLineWidthPx(5.16), 475);
  assert.ok(doesTextFitSingleLine('先讲清主题和要解决的问题。', 6.98, 48));
  assert.ok(doesTextFitSingleLine('写清时间和负责人。', 5.16, 48));
  assert.ok(!doesTextFitSingleLine('这句文案故意写得更长一些来验证会换行。', 5.16, 48));
});
