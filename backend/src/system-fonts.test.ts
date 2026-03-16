import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFontFamiliesFromFcScanOutput, stripFontFileExtension } from './system-fonts.ts';

test('parseFontFamiliesFromFcScanOutput 去重并忽略空白字体名', () => {
  const families = parseFontFamiliesFromFcScanOutput(`
Noto Sans CJK SC||
Noto Sans CJK SC| |文泉驛正黑
WenQuanYi Zen Hei||
`);

  assert.deepEqual(families, ['Noto Sans CJK SC', '文泉驛正黑', 'WenQuanYi Zen Hei']);
});

test('stripFontFileExtension 去掉字体文件扩展名', () => {
  assert.equal(stripFontFileExtension('NotoSansCJK-Regular.ttc'), 'NotoSansCJK-Regular');
  assert.equal(stripFontFileExtension('wqy-zenhei.ttf'), 'wqy-zenhei');
});
