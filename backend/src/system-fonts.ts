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

function normalizePath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function buildFallbackFontLabel(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[_-]+/g, ' ') || base;
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
      const label = [family, style].filter(Boolean).join(' ');
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
    label: font.label || buildFallbackFontLabel(font.name),
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
