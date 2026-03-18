#!/usr/bin/env bun

import { readFileSync } from 'fs';
import puppeteer from 'puppeteer';
import {
  PPT_TEXT_CHAR_WIDTH_FACTOR,
  PPT_TEXT_FULL_WIDTH_EM,
  PPT_TEXT_LINE_HEIGHT_FACTOR,
  PPT_POINT_TO_PIXEL_RATIO,
  PPT_TEXT_SAFE_HEIGHT_PADDING,
  PPT_TEXT_SAFE_WIDTH_RATIO,
  calculateMaxCharsPerLine,
  calculateSafeSingleLineWidthPx,
  calculateSafeTextBoxHeight,
  estimateTextWidthPx,
  recommendSingleLineChars,
} from '../backend/src/ppt-text-layout.ts';

const fontFilePath = new URL('../frontend/public/fonts/last-version-ppt-cjk-subset.otf', import.meta.url);
const fontFileDataUrl = `data:font/otf;base64,${readFileSync(fontFilePath).toString('base64')}`;
const browserExecutablePath = Bun.which('google-chrome') ?? Bun.which('chromium') ?? Bun.which('chromium-browser');
const canvasFontFamily = '_LastVersionPptCanvasSubset';

const sampleBoxes = [
  { label: '封面副标题', width: 11.56, fontSize: 56, text: '请告诉智能助手，这份演示稿要讲什么。' },
  { label: '目录说明', width: 6.98, fontSize: 48, text: '讲清主题重点。' },
  { label: '目录说明（渲染）', width: 6.98, fontSize: 48, text: '说明这份演示稿要讲什么。' },
  { label: '正文右侧说明', width: 5.16, fontSize: 48, text: '写清时间安排。' },
  { label: '渲染右侧说明', width: 5.2, fontSize: 48, text: '截图后可检查排版。' },
];

if (!browserExecutablePath) {
  throw new Error('没有找到可用浏览器，请先安装 google-chrome 或 chromium。');
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: browserExecutablePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face {
      font-family: '${canvasFontFamily}';
      src: url('${fontFileDataUrl}') format('opentype');
      font-display: block;
    }
    body { margin: 0; font-family: '${canvasFontFamily}', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif; }
  </style></head><body></body></html>`);

  const measurements = await page.evaluate(async ({ sampleBoxes, fontFamily, pointToPixelRatio }) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 canvas 上下文');

    return await Promise.all(sampleBoxes.map(async item => {
      const fontSizePx = item.fontSize * pointToPixelRatio;
      await document.fonts.load(`${fontSizePx}px "${fontFamily}"`);
      await document.fonts.ready;
      context.font = `${fontSizePx}px "${fontFamily}", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`;
      const measuredWidthPx = context.measureText(item.text).width;
      const measuredCjkWidthPx = context.measureText('汉').width;
      return {
        ...item,
        measuredWidthPx,
        measuredCjkWidthPx,
      };
    }));
  }, { sampleBoxes, fontFamily: canvasFontFamily, pointToPixelRatio: PPT_POINT_TO_PIXEL_RATIO });

  console.log('PptxGenJS 默认文本尺寸计算');
  console.log(`- 行高公式：fontSize × ${PPT_TEXT_LINE_HEIGHT_FACTOR} ÷ 100 × 行数`);
  console.log(`- 安全高度：理论高度 + ${PPT_TEXT_SAFE_HEIGHT_PADDING.toFixed(2)} 英寸`);
  console.log(`- Canvas 实测：中文和全角标点约为 ${PPT_TEXT_FULL_WIDTH_EM.toFixed(2)} × fontSize`);
  console.log(`- 估算公式：maxChars = floor(floor(w × 72) × ${PPT_TEXT_CHAR_WIDTH_FACTOR} ÷ fontSize)`);
  console.log(`- 严格校验：measureText(text).width <= w × 96 × ${PPT_TEXT_SAFE_WIDTH_RATIO.toFixed(2)}`);
  console.log('');

  console.table([88, 72, 56, 48].map(fontSize => ({
    fontSize,
    theoryHeight: calculateSafeTextBoxHeight(fontSize, 1, 0),
    safeHeight: calculateSafeTextBoxHeight(fontSize),
    measuredCjkWidthPx: measurements.find(item => item.fontSize === fontSize)?.measuredCjkWidthPx ?? '',
  })));

  console.table(measurements.map(item => ({
    label: item.label,
    text: item.text,
    width: item.width,
    fontSize: item.fontSize,
    measuredWidthPx: Number(item.measuredWidthPx.toFixed(2)),
    estimatedWidthPx: estimateTextWidthPx(item.text, item.fontSize),
    safeWidthPx: calculateSafeSingleLineWidthPx(item.width),
    maxChars: calculateMaxCharsPerLine(item.width, item.fontSize),
    safeChars: recommendSingleLineChars(item.width, item.fontSize),
    fitsSingleLine: item.measuredWidthPx <= calculateSafeSingleLineWidthPx(item.width),
  })));
} finally {
  await browser.close();
}
