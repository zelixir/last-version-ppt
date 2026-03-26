import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readFontLabelFromMetadata } from '../backend/src/system-fonts.ts';

type CliOptions = {
  fontPath?: string;
  downloadUrl?: string;
};

const DEFAULT_FONT_NAME = 'msyh.ttc';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--font' && argv[i + 1]) {
      options.fontPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--download-url' && argv[i + 1]) {
      options.downloadUrl = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

function findExistingFont(fontName: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), fontName),
    path.join(process.cwd(), 'scripts', fontName),
    path.join(os.tmpdir(), 'last-version-ppt-font-test', fontName),
    path.join('/usr/share/fonts', fontName),
    path.join('/usr/local/share/fonts', fontName),
    path.join(process.env.HOME || '', '.local', 'share', 'fonts', fontName),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', fontName),
  ].filter(Boolean);
  return candidates.find(filePath => existsSync(filePath)) ?? null;
}

async function ensureFontFile(fontPath: string | undefined, downloadUrl: string | undefined): Promise<string> {
  if (fontPath && existsSync(fontPath)) return fontPath;
  const localFont = findExistingFont(DEFAULT_FONT_NAME);
  if (localFont) return localFont;
  const sourceUrl = downloadUrl || process.env.MSYH_TTC_URL;
  if (!sourceUrl) {
    throw new Error(`没有找到 ${DEFAULT_FONT_NAME}。请先把字体放到常见字体目录，或通过 --download-url / MSYH_TTC_URL 提供下载地址。`);
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`下载 ${DEFAULT_FONT_NAME} 失败：${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const targetPath = path.join(os.tmpdir(), 'last-version-ppt-font-test', DEFAULT_FONT_NAME);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, buffer);
  return targetPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fontPath = await ensureFontFile(options.fontPath, options.downloadUrl);
  const label = readFontLabelFromMetadata(fontPath);
  const stat = statSync(fontPath);
  console.log(`字体文件：${fontPath}`);
  console.log(`文件大小：${(stat.size / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`提取名称：${label || '（未能从元数据中提取到有效名称）'}`);
  if (!label) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
