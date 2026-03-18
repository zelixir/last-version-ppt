import assert from 'node:assert/strict'
import test from 'node:test'

import puppeteer from 'puppeteer'

import { PPT_POINT_TO_PIXEL_RATIO } from '../backend/src/ppt-text-layout.ts'

const browserPath = Bun.which('google-chrome') ?? Bun.which('chromium') ?? Bun.which('chromium-browser')
const canvasFontStack = '"Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif'
const widthTolerancePx = 16

const testCases = [
  { label: '默认封面副标题', fontSize: 56, text: '请告诉智能助手，这份演示稿要讲什么。' },
  { label: '默认目录说明', fontSize: 48, text: '讲清主题重点。' },
  { label: '默认正文说明', fontSize: 48, text: '写清时间安排。' },
]

test('canvas 单行文字图片的像素宽度与 measureText 宽度保持接近', async () => {
  assert.ok(browserPath, '没有找到可用浏览器，请先安装 google-chrome 或 chromium。')

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: browserPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
    await page.setContent('<!doctype html><html><head><style>html, body { margin: 0; background: #ffffff; }</style></head><body></body></html>')

    const results = await page.evaluate(async ({ cases, fontStack, pointToPixelRatio }) => {
      return await Promise.all(cases.map(async item => {
        const fontSizePx = item.fontSize * pointToPixelRatio
        await document.fonts.load(`${fontSizePx}px ${fontStack}`)
        await document.fonts.ready

        const canvas = document.createElement('canvas')
        canvas.width = 2200
        canvas.height = Math.ceil(fontSizePx * 3)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建 canvas 上下文')

        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.font = `${fontSizePx}px ${fontStack}`
        context.textBaseline = 'top'
        context.fillStyle = '#000000'

        const metrics = context.measureText(item.text)
        const drawX = 40
        const drawY = 20
        context.fillText(item.text, drawX, drawY)

        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
        let minX = width
        let maxX = -1

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4
            const alpha = data[index + 3]
            const isWhite = data[index] > 250 && data[index + 1] > 250 && data[index + 2] > 250
            if (alpha > 0 && !isWhite) {
              minX = Math.min(minX, x)
              maxX = Math.max(maxX, x)
            }
          }
        }

        const cvWidth = maxX >= minX ? (maxX - minX + 1) : 0
        return {
          ...item,
          measureTextWidth: Number(metrics.width.toFixed(2)),
          cvWidth,
          diffPx: Number((cvWidth - metrics.width).toFixed(2)),
        }
      }))
    }, { cases: testCases, fontStack: canvasFontStack, pointToPixelRatio: PPT_POINT_TO_PIXEL_RATIO })

    console.table(results)

    for (const result of results) {
      assert.ok(
        Math.abs(result.cvWidth - result.measureTextWidth) <= widthTolerancePx,
        `${result.label} 的像素宽度 ${result.cvWidth}px 与 canvas 宽度 ${result.measureTextWidth}px 不一致`,
      )
    }
  } finally {
    await browser.close()
  }
})
