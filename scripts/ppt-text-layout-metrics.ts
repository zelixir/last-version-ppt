#!/usr/bin/env bun

import {
  PPT_TEXT_CHAR_WIDTH_FACTOR,
  PPT_TEXT_LINE_HEIGHT_FACTOR,
  PPT_TEXT_SAFE_HEIGHT_PADDING,
  calculateMaxCharsPerLine,
  calculateSafeTextBoxHeight,
} from '../backend/src/ppt-text-layout.ts';

const fontSizes = [88, 72, 56, 48];
const sampleBoxes = [
  { label: '封面副标题', width: 11.56, fontSize: 56 },
  { label: '目录说明', width: 6.98, fontSize: 48 },
  { label: '正文右侧说明', width: 5.16, fontSize: 48 },
  { label: '正文三行列表', width: 5.24, fontSize: 48, lines: 3 },
];

console.log('PptxGenJS 默认文本尺寸计算');
console.log(`- 行高公式：fontSize × ${PPT_TEXT_LINE_HEIGHT_FACTOR} ÷ 100 × 行数`);
console.log(`- 安全高度：理论高度 + ${PPT_TEXT_SAFE_HEIGHT_PADDING.toFixed(2)} 英寸`);
console.log(`- 单行容字：floor(floor(w × 72) × ${PPT_TEXT_CHAR_WIDTH_FACTOR} ÷ fontSize)`);
console.log('');

console.table(fontSizes.map(fontSize => ({
  fontSize,
  theoryHeight: calculateSafeTextBoxHeight(fontSize, 1, 0),
  safeHeight: calculateSafeTextBoxHeight(fontSize),
})));

console.table(sampleBoxes.map(item => ({
  label: item.label,
  width: item.width,
  fontSize: item.fontSize,
  maxChars: calculateMaxCharsPerLine(item.width, item.fontSize),
  safeHeight: calculateSafeTextBoxHeight(item.fontSize, item.lines ?? 1),
})));
