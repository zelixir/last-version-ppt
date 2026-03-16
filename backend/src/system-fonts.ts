import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const FONT_EXTENSIONS = new Set(['.ttf', '.ttc', '.otf', '.woff', '.woff2']);

const FONT_MIME_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.ttc': 'font/collection',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

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

function collectFontFiles(dir: string, maxDepth = 3, currentDepth = 0): Array<{ name: string; filePath: string; size: number }> {
  if (currentDepth > maxDepth) return [];
  const results: Array<{ name: string; filePath: string; size: number }> = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFontFiles(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = statSync(fullPath);
          results.push({ name: entry.name, filePath: fullPath, size: stat.size });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable directories */ }

  return results;
}

let cachedFontList: Array<{ name: string; filePath: string; size: number }> | null = null;

export function listSystemFonts(): Array<{ name: string; filePath: string; size: number }> {
  if (cachedFontList) return cachedFontList;

  const dirs = getSystemFontDirs();
  const allFonts: Array<{ name: string; filePath: string; size: number }> = [];

  for (const dir of dirs) {
    allFonts.push(...collectFontFiles(dir));
  }

  // Deduplicate by name (prefer first occurrence)
  const seen = new Set<string>();
  cachedFontList = allFonts.filter(font => {
    if (seen.has(font.name)) return false;
    seen.add(font.name);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

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
