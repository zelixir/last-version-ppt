import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const FONT_EXTENSIONS = new Set(['.ttf', '.ttc', '.otf', '.woff', '.woff2']);

const FONT_MIME_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.ttc': 'font/collection',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

interface SystemFontInfo {
  name: string;
  filePath: string;
  size: number;
  label?: string;
}

type FontNameRecord = {
  platformId: number;
  encodingId: number;
  languageId: number;
  nameId: number;
  length: number;
  offset: number;
};

const PREFERRED_NAME_LANGS = [0x0804, 0x0c04, 0x1004, 0x1404, 0x0404, 0x0409];
const FONT_METADATA_EXTENSIONS = new Set(['.ttf', '.ttc', '.otf']);
const utf16beDecoder = new TextDecoder('utf-16be');
const macintoshDecoder = (() => {
  try {
    return new TextDecoder('macintosh');
  } catch {
    return new TextDecoder('latin1');
  }
})();
const metadataLabelCache = new Map<string, string | null>();

function sanitizeFontLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\p{C}+/gu, ' ').replace(/\uFFFD+/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned.slice(0, 160);
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function buildFallbackFontLabel(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[_-]+/g, ' ') || base;
}

function decodeNameRecord(buffer: Buffer, record: FontNameRecord, stringBase: number, tableStart: number, tableLength: number): string | null {
  const start = stringBase + record.offset;
  const end = start + record.length;
  const tableEnd = tableStart + tableLength;
  if (start < tableStart || end > tableEnd || start < 0 || end > buffer.length) return null;
  const slice = buffer.subarray(start, end);

  if (record.platformId === 0 || record.platformId === 3) {
    return sanitizeFontLabel(utf16beDecoder.decode(slice));
  }
  if (record.platformId === 1) {
    return sanitizeFontLabel(macintoshDecoder.decode(slice));
  }

  return sanitizeFontLabel(slice.toString('utf8'));
}

function readNameTable(buffer: Buffer, fontOffset: number): { records: (FontNameRecord & { text: string })[]; stringBase: number } | null {
  if (buffer.length < fontOffset + 12) return null;
  const numTables = buffer.readUInt16BE(fontOffset + 4);
  const tableDirStart = fontOffset + 12;
  let nameTableOffset = 0;
  let nameTableLength = 0;

  for (let i = 0; i < numTables; i += 1) {
    const entryOffset = tableDirStart + i * 16;
    if (entryOffset + 16 > buffer.length) break;
    const tag = buffer.toString('ascii', entryOffset, entryOffset + 4);
    if (tag === 'name') {
      nameTableOffset = buffer.readUInt32BE(entryOffset + 8);
      nameTableLength = buffer.readUInt32BE(entryOffset + 12);
      break;
    }
  }

  if (!nameTableOffset || !nameTableLength) return null;
  const tableStart = fontOffset + nameTableOffset;
  if (tableStart + nameTableLength > buffer.length || tableStart + 6 > buffer.length) return null;
  const tableEnd = tableStart + nameTableLength;

  const recordCount = buffer.readUInt16BE(tableStart + 2);
  const stringOffset = buffer.readUInt16BE(tableStart + 4);
  const stringBase = tableStart + stringOffset;
  if (stringBase < tableStart || stringBase > tableEnd) return null;
  const records: (FontNameRecord & { text: string })[] = [];

  for (let i = 0; i < recordCount; i += 1) {
    const recordOffset = tableStart + 6 + i * 12;
    if (recordOffset + 12 > buffer.length) break;
    const record: FontNameRecord = {
      platformId: buffer.readUInt16BE(recordOffset),
      encodingId: buffer.readUInt16BE(recordOffset + 2),
      languageId: buffer.readUInt16BE(recordOffset + 4),
      nameId: buffer.readUInt16BE(recordOffset + 6),
      length: buffer.readUInt16BE(recordOffset + 8),
      offset: buffer.readUInt16BE(recordOffset + 10),
    };
    const text = decodeNameRecord(buffer, record, stringBase, tableStart, nameTableLength);
    if (text) records.push({ ...record, text });
  }

  return { records, stringBase };
}

function pickName(records: Array<FontNameRecord & { text: string }>, nameIds: number[], languages: number[]): string | null {
  for (const lang of languages) {
    const match = records.find(record => nameIds.includes(record.nameId) && record.languageId === lang && record.text);
    if (match?.text) return match.text;
  }
  const fallback = records.find(record => nameIds.includes(record.nameId) && record.text);
  return fallback?.text ?? null;
}

function extractFontLabelFromBuffer(buffer: Buffer, fontOffset: number): string | null {
  const nameTable = readNameTable(buffer, fontOffset);
  if (!nameTable) return null;

  const fullName = pickName(nameTable.records, [4], PREFERRED_NAME_LANGS)
    ?? pickName(nameTable.records, [4], []);
  const familyName = pickName(nameTable.records, [1], PREFERRED_NAME_LANGS)
    ?? pickName(nameTable.records, [1], []);
  const subfamily = pickName(nameTable.records, [2], PREFERRED_NAME_LANGS)
    ?? pickName(nameTable.records, [2], []);

  const combinedFamily = familyName && subfamily && !/^(regular|normal)$/i.test(subfamily) ? `${familyName} ${subfamily}` : familyName;
  return (fullName || combinedFamily || familyName)?.replace(/\s+/g, ' ').trim() || null;
}

function extractFontLabelFromTtc(buffer: Buffer): string | null {
  if (buffer.length < 16) return null;
  const numFonts = buffer.readUInt32BE(8);
  for (let i = 0; i < numFonts; i += 1) {
    const fontOffset = buffer.readUInt32BE(12 + i * 4);
    const label = extractFontLabelFromBuffer(buffer, fontOffset);
    if (label) return label;
  }
  return null;
}

function readFontLabelFromMetadata(filePath: string): string | null {
  if (metadataLabelCache.has(filePath)) return metadataLabelCache.get(filePath) ?? null;

  const ext = path.extname(filePath).toLowerCase();
  if (!FONT_METADATA_EXTENSIONS.has(ext)) {
    metadataLabelCache.set(filePath, null);
    return null;
  }

  try {
    const buffer = readFileSync(filePath);
    const isTtc = buffer.subarray(0, 4).toString('ascii') === 'ttcf';
    const label = isTtc ? extractFontLabelFromTtc(buffer) : extractFontLabelFromBuffer(buffer, 0);
    const sanitized = sanitizeFontLabel(label);
    metadataLabelCache.set(filePath, sanitized || null);
    return sanitized || null;
  } catch {
    metadataLabelCache.set(filePath, null);
    return null;
  }
}

function readFontLabelsFromFontconfig(): Record<string, string> {
  try {
    const output = execFileSync('fc-list', ['--format', '%{file}||%{family[0]}||%{style[0]}\\n'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const labels: Record<string, string> = {};
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [filePath, familyRaw = '', styleRaw = ''] = line.split('||');
      if (!filePath) continue;
      const family = familyRaw.trim();
      const style = styleRaw.trim();
      const label = sanitizeFontLabel([family, style].filter(Boolean).join(' '));
      if (!label) continue;
      labels[normalizePath(filePath)] = label;
    }
    return labels;
  } catch {
    return {};
  }
}

function getSystemFontDirs(): string[] {
  const dirs: string[] = [];
  const platform = process.platform;

  if (platform === 'linux') {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts');
    const home = process.env.HOME;
    if (home) dirs.push(path.join(home, '.local', 'share', 'fonts'));
  } else if (platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/Library/Fonts');
    const home = process.env.HOME;
    if (home) dirs.push(path.join(home, 'Library', 'Fonts'));
  } else if (platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    dirs.push(path.join(windir, 'Fonts'));
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) dirs.push(path.join(localAppData, 'Microsoft', 'Windows', 'Fonts'));
  }

  return dirs.filter(dir => existsSync(dir));
}

function collectFontFiles(
  dir: string,
  fontLabels: Record<string, string>,
  maxDepth = 3,
  currentDepth = 0,
): SystemFontInfo[] {
  if (currentDepth > maxDepth) return [];
  const results: SystemFontInfo[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // skip symlinks to avoid circular traversal
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFontFiles(fullPath, fontLabels, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = statSync(fullPath);
          const normalizedPath = normalizePath(fullPath);
          results.push({
            name: entry.name,
            filePath: fullPath,
            size: stat.size,
            label: fontLabels[normalizedPath],
          });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable directories */ }

  return results;
}

let cachedFontList: SystemFontInfo[] | null = null;

export function listSystemFonts(): SystemFontInfo[] {
  if (cachedFontList) return cachedFontList;

  const fontLabels = readFontLabelsFromFontconfig();
  const dirs = getSystemFontDirs();
  const allFonts: SystemFontInfo[] = [];

  for (const dir of dirs) {
    allFonts.push(...collectFontFiles(dir, fontLabels));
  }

  // Deduplicate by name (prefer first occurrence)
  const seen = new Set<string>();
  cachedFontList = allFonts.filter(font => {
    if (seen.has(font.name)) return false;
    seen.add(font.name);
    return true;
  }).map(font => ({
    ...font,
    label: font.label || readFontLabelFromMetadata(font.filePath) || buildFallbackFontLabel(font.name),
  })).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name, 'zh-Hans-CN'));

  return cachedFontList;
}

export function getSystemFontData(fontName: string): { data: Buffer; mimeType: string } | null {
  const fonts = listSystemFonts();
  const font = fonts.find(f => f.name === fontName);
  if (!font || !existsSync(font.filePath)) return null;

  try {
    const data = readFileSync(font.filePath) as Buffer;
    const mimeType = FONT_MIME_TYPES[path.extname(font.name).toLowerCase()] ?? 'application/octet-stream';
    return { data, mimeType };
  } catch {
    return null;
  }
}

export const __systemFontTestUtils = {
  extractFontLabelFromBuffer,
  sanitizeFontLabel,
};
