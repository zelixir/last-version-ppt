import { execFileSync } from 'child_process';
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

export interface SystemFontRecord {
  name: string;
  filePath: string;
  size: number;
  families: string[];
}

export function stripFontFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '');
}

export function parseFontFamiliesFromFcScanOutput(output: string): string[] {
  const seen = new Set<string>();
  return output
    .split(/\r?\n/u)
    .flatMap(line => line.split('|'))
    .map(name => name.trim())
    .filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function readFontFamilies(filePath: string, fileName: string): string[] {
  const fallback = [stripFontFileExtension(fileName)];
  if (process.platform !== 'linux') return fallback;

  try {
    const output = execFileSync(
      'fc-scan',
      ['--format', '%{family[0]}|%{family[1]}|%{family[2]}\n', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const families = parseFontFamiliesFromFcScanOutput(output);
    return families.length ? families : fallback;
  } catch {
    return fallback;
  }
}

function collectFontFiles(dir: string, maxDepth = 3, currentDepth = 0): SystemFontRecord[] {
  if (currentDepth > maxDepth) return [];
  const results: SystemFontRecord[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // skip symlinks to avoid circular traversal
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFontFiles(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = statSync(fullPath);
          results.push({
            name: entry.name,
            filePath: fullPath,
            size: stat.size,
            families: readFontFamilies(fullPath, entry.name),
          });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable directories */ }

  return results;
}

let cachedFontList: SystemFontRecord[] | null = null;

export function listSystemFonts(): SystemFontRecord[] {
  if (cachedFontList) return cachedFontList;

  const dirs = getSystemFontDirs();
  const allFonts: SystemFontRecord[] = [];

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
