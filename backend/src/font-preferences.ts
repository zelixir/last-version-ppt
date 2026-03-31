import type { FontData } from './libreoffice-converter.ts';
import { getSetting, setSetting } from './db.ts';
import { getSystemFontData, listSystemFonts } from './system-fonts.ts';

const FONT_SETTING_KEY = 'selectedFontFiles';
const DEFAULT_FONT_FILES = [
  'msyh.ttc',
  'msyhbd.ttc',
  'simhei.ttf',
  'simsun.ttc',
  'simkai.ttf',
  'simfang.ttf',
  'arial.ttf',
  'arialbd.ttf',
  'calibri.ttf',
  'cambria.ttc',
  'times.ttf',
  'timesbd.ttf',
  'segoeui.ttf',
  'segoeuib.ttf',
];

function normalizeFontList(rawValue: unknown): string[] {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
    } catch {
      return rawValue.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function pickDefaultFonts() {
  const allFonts = listSystemFonts();
  const availableNames = new Set(allFonts.map(font => font.name));
  const matchedDefaults = DEFAULT_FONT_FILES.filter(name => availableNames.has(name));
  if (matchedDefaults.length > 0) return matchedDefaults;
  return allFonts.slice(0, Math.min(6, allFonts.length)).map(font => font.name);
}

export function getDefaultFontCandidates(): string[] {
  return DEFAULT_FONT_FILES;
}

export function getSelectedFontNames(): string[] {
  const storedValue = getSetting(FONT_SETTING_KEY);
  const requestedFonts = normalizeFontList(storedValue);
  const availableNames = new Set(listSystemFonts().map(font => font.name));
  const filtered = requestedFonts.filter(name => availableNames.has(name));
  const effective = filtered.length > 0 ? filtered : pickDefaultFonts();
  if (!requestedFonts.length && effective.length > 0) {
    setSetting(FONT_SETTING_KEY, JSON.stringify(effective));
  }
  return effective;
}

export function setSelectedFontNames(fontNames: string[]): string[] {
  const availableNames = new Set(listSystemFonts().map(font => font.name));
  const normalized = normalizeFontList(fontNames).filter(name => availableNames.has(name));
  const effective = normalized.length > 0 ? normalized : pickDefaultFonts();
  setSetting(FONT_SETTING_KEY, JSON.stringify(effective));
  cachedFontData = null;
  return effective;
}

export function listFontsWithSelection(): Array<{ name: string; displayName: string; size: number; selected: boolean; defaultPreferred: boolean }> {
  const selected = new Set(getSelectedFontNames());
  const defaults = new Set(DEFAULT_FONT_FILES);
  return listSystemFonts()
    .map(font => ({
      name: font.name,
      displayName: font.label || font.name,
      size: font.size,
      selected: selected.has(font.name),
      defaultPreferred: defaults.has(font.name),
    }))
    .sort((a, b) => {
      const selectedDiff = Number(b.selected) - Number(a.selected);
      if (selectedDiff) return selectedDiff;
      const defaultDiff = Number(b.defaultPreferred) - Number(a.defaultPreferred);
      if (defaultDiff) return defaultDiff;
      return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
    });
}

let cachedFontData: { key: string; fonts: FontData[] } | null = null;

export function loadSelectedFontData(): FontData[] {
  const names = getSelectedFontNames();
  const cacheKey = names.join('|') || 'none';
  if (cachedFontData?.key === cacheKey) return cachedFontData.fonts;

  const fonts: FontData[] = [];
  for (const name of names) {
    const font = getSystemFontData(name);
    if (!font) continue;
    fonts.push({ filename: name, data: new Uint8Array(font.data) });
  }

  cachedFontData = { key: cacheKey, fonts };
  return fonts;
}

export function clearFontCache(): void {
  cachedFontData = null;
}
